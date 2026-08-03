import { isInterpolated, referencesInString } from './terraform-interpolations.js';

import type { JsonEntry, JsonValue } from './json-document.js';
import type {
  TerraformAssignment,
  TerraformAttribute,
  TerraformBlock,
  TerraformDocument,
  TerraformEnvBinding,
  TerraformSecretRef,
  TerraformUnresolved,
} from './terraform-blocks.js';
import type { TerraformReference } from './terraform-values.js';

// Terraform's JSON syntax → the SAME `TerraformDocument` the HCL reader produces (epic-16).
//
// `.tf.json` is not a second Terraform; it is the same language written differently, and
// HashiCorp specifies the mapping exactly: a top-level key is a block type, the objects nested
// under it supply that block type's labels, and the innermost object is the block body. So the
// whole of this module is that mapping — after it, `emitTerraformFile` runs unchanged and every
// downstream consumer (node types, addresses, `count` expansion, secret bindings, the framework
// adapter's CONFIGURES and DEPLOYED_AS edges) works on `.tf.json` for free.
//
// Both spellings of repetition are handled, because Terraform allows both: `{"resource": {...}}`
// and `{"resource": [{...}, {...}]}` mean the same thing, since JSON objects cannot repeat a key.

/** Label count per block kind — the same roster `terraform-addresses.ts` models as nodes. */
const LABEL_DEPTH = new Map<string, number>([
  ['resource', 2],
  ['data', 2],
  ['module', 1],
  ['variable', 1],
  ['output', 1],
  ['provider', 1],
]);

const SECRET_ATTRIBUTES = new Set(['secret_id', 'secret']);

const ENV_KEY = 'env';

/** Bound on one document: a hostile file costs a truncated read, never the run (PRD §42.5). */
const MAX_BLOCKS = 2000;
const MAX_SCAN_NODES = 20_000;

const objectsOf = (value: JsonValue): readonly JsonValue[] =>
  value.kind === 'array' ? value.items : [value];

interface Scan {
  readonly references: TerraformReference[];
  readonly secrets: TerraformSecretRef[];
  readonly unresolved: TerraformUnresolved[];
  readonly envBindings: TerraformEnvBinding[];
}

/**
 * A JSON value that is EXACTLY one bare reference — `"${google_pubsub_topic.deal_events.name}"`
 * and nothing more. The HCL reader gets this from the grammar (an expression that is not a
 * `variable_expr` yields no reference); JSON has no expression grammar, so the shape is asserted
 * here. `"${format(\"%s\", a.b)}"` and `"${a.b}-dlq"` both fail it, exactly as their HCL spellings do.
 */
const REFERENCE_ONLY = /^\$\{\s*[A-Za-z_][A-Za-z0-9_.-]*\s*\}$/;

const soleReference = (value: JsonValue): TerraformReference | undefined => {
  if (value.kind !== 'string' || !REFERENCE_ONLY.test(value.value.trim())) {
    return undefined;
  }
  const references = referencesInString(value);
  return references.length === 1 ? references[0] : undefined;
};

/** The literal `name` of one `env` object, or undefined when it is absent or interpolates. */
const envVariableName = (entries: readonly JsonEntry[]): string | undefined => {
  const name = entries.find((child) => child.key === 'name')?.value;
  if (name?.kind !== 'string' || isInterpolated(name.value) || name.value === '') {
    return undefined;
  }
  return name.value;
};

/** One `{"name": "X", "value": "${…}"}` object, when both halves are stated the required way. */
const envBindingOf = (
  candidate: JsonValue,
  range: JsonEntry['range'],
): TerraformEnvBinding | undefined => {
  const entries = candidate.kind === 'object' ? candidate.entries : [];
  const envName = envVariableName(entries);
  const value = entries.find((child) => child.key === 'value')?.value;
  const reference = value === undefined ? undefined : soleReference(value);
  return envName === undefined || reference === undefined
    ? undefined
    : { envName, address: reference.address, range };
};

/** `"env": {…}` — or an array of them, which Terraform allows because JSON keys cannot repeat. */
const envBindingsOf = (entry: JsonEntry): readonly TerraformEnvBinding[] =>
  objectsOf(entry.value)
    .map((candidate) => envBindingOf(candidate, entry.range))
    .filter((binding): binding is TerraformEnvBinding => binding !== undefined);

const scanEntry = (entry: JsonEntry, scan: Scan): void => {
  const value = entry.value;
  if (value.kind !== 'string') {
    return;
  }
  if (isInterpolated(value.value)) {
    scan.references.push(...referencesInString(value));
    scan.unresolved.push({ name: entry.key, range: entry.range });
    return;
  }
  if (value.value !== '' && SECRET_ATTRIBUTES.has(entry.key)) {
    scan.secrets.push({ value: value.value, range: entry.range });
  }
};

/**
 * One bounded walk of a block body collecting every fact that can appear at any depth — the JSON
 * counterpart of the HCL reader's `scanBody`, and deliberately the same shape so the two produce
 * the same facts for the same configuration.
 */
const scanEntries = (entries: readonly JsonEntry[], scan: Scan, stack: JsonValue[]): void => {
  for (const entry of entries) {
    scanEntry(entry, scan);
    if (entry.key === ENV_KEY) {
      scan.envBindings.push(...envBindingsOf(entry));
    }
    stack.push(entry.value);
  }
};

const scanBody = (body: JsonValue): Scan => {
  const scan: Scan = { references: [], secrets: [], unresolved: [], envBindings: [] };
  const stack: JsonValue[] = [body];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_SCAN_NODES) {
    const value = stack.pop();
    visited += 1;
    if (value?.kind === 'array') {
      stack.push(...value.items);
    } else if (value?.kind === 'object') {
      scanEntries(value.entries, scan, stack);
    }
  }
  return scan;
};

const WHOLE_NUMBER = /^\d+$/;

/** `"count": 3` and `"count": "3"` both state three; anything else states no whole number. */
const integerOf = (value: JsonValue): number | undefined => {
  if (value.kind === 'number') {
    return Number.isInteger(value.value) && value.value >= 0 ? value.value : undefined;
  }
  return value.kind === 'string' && WHOLE_NUMBER.test(value.value)
    ? Number(value.value)
    : undefined;
};

const attributeOf = (entry: JsonEntry): TerraformAttribute | undefined => {
  const value = entry.value;
  const integer = integerOf(value);
  if (value.kind === 'string') {
    const interpolated = isInterpolated(value.value);
    return {
      range: entry.range,
      interpolated,
      ...(interpolated ? {} : { literal: value.value }),
      ...(integer === undefined || interpolated ? {} : { integer }),
    };
  }
  if (value.kind !== 'number') {
    // An object or array is a nested block, and a boolean/null is neither a literal string nor a
    // count — the HCL reader records neither, and neither does this one.
    return undefined;
  }
  return { range: entry.range, interpolated: false, ...(integer === undefined ? {} : { integer }) };
};

/** Direct attributes of one body, first occurrence winning, exactly as the HCL reader does. */
const topLevelAttributes = (body: JsonValue): ReadonlyMap<string, TerraformAttribute> => {
  const attributes = new Map<string, TerraformAttribute>();
  for (const entry of body.kind === 'object' ? body.entries : []) {
    const attribute = attributes.has(entry.key) ? undefined : attributeOf(entry);
    if (attribute !== undefined) {
      attributes.set(entry.key, attribute);
    }
  }
  return attributes;
};

const blockFrom = (
  kind: string,
  labels: readonly string[],
  body: JsonValue,
  range: TerraformBlock['range'],
): TerraformBlock => {
  const scan = scanBody(body);
  return {
    kind,
    labels,
    range,
    attributes: topLevelAttributes(body),
    references: scan.references,
    secrets: scan.secrets,
    unresolved: scan.unresolved,
    envBindings: scan.envBindings,
  };
};

interface Descent {
  readonly kind: string;
  readonly remaining: number;
  readonly labels: readonly string[];
  readonly value: JsonValue;
  readonly range: TerraformBlock['range'];
}

/**
 * Walk `remaining` levels of label objects and emit the blocks underneath.
 *
 * The block's RANGE is the innermost labelled entry (`"deal_events": { … }`), which is the closest
 * JSON equivalent of the HCL `resource "…" "deal_events" { … }` node the HCL reader points at.
 */
const descend = (descent: Descent, into: TerraformBlock[]): void => {
  for (const body of objectsOf(descent.value)) {
    if (descent.remaining === 0) {
      into.push(blockFrom(descent.kind, descent.labels, body, descent.range));
      continue;
    }
    for (const entry of body.kind === 'object' ? body.entries : []) {
      descend(
        {
          kind: descent.kind,
          remaining: descent.remaining - 1,
          labels: [...descent.labels, entry.key],
          value: entry.value,
          range: entry.range,
        },
        into,
      );
    }
  }
};

/**
 * One parsed `.tf.json` document as blocks and (for `.tfvars.json`) top-level assignments.
 *
 * A top-level key that names no modelled block kind — `terraform`, `locals`, `moved` — is skipped
 * for exactly the reason the HCL reader skips it: it configures Terraform rather than describing a
 * component of the analyzed system.
 */
export const readTerraformJsonDocument = (root: JsonValue): TerraformDocument => {
  const blocks: TerraformBlock[] = [];
  const assignments: TerraformAssignment[] = [];
  for (const entry of root.kind === 'object' ? root.entries : []) {
    const depth = LABEL_DEPTH.get(entry.key);
    assignments.push({ name: entry.key, range: entry.range });
    if (depth !== undefined && blocks.length < MAX_BLOCKS) {
      descend(
        { kind: entry.key, remaining: depth, labels: [], value: entry.value, range: entry.range },
        blocks,
      );
    }
  }
  return { blocks, assignments };
};
