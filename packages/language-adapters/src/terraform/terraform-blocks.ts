import { namedChildrenOf, rangeOfNode } from '../tree-sitter/syntax.js';

import { readIntegerLiteral, readLiteral, readReference } from './terraform-values.js';

import type { TerraformReference } from './terraform-values.js';
import type { SourceRange } from '@impactgraph/domain';
import type { Node } from 'web-tree-sitter';

// The CST → block model reader. Everything downstream works on `TerraformBlock`; no tree-sitter
// node reaches the graph (PRD §C14).
//
// Top-level attributes are kept separate from the recursive scan on purpose. A Cloud Run service
// has a top-level `name = "deals-api"` AND a nested `env { name = "DEAL_EVENTS_TOPIC" }`; reading
// the resource's name from a flattened attribute list would pick whichever came first.

export interface TerraformAttribute {
  readonly range: SourceRange;
  readonly literal?: string;
  /** A whole number written literally in the source — `count = 3` and nothing cleverer. */
  readonly integer?: number;
  readonly interpolated: boolean;
}

export interface TerraformSecretRef {
  readonly value: string;
  readonly range: SourceRange;
}

export interface TerraformUnresolved {
  readonly name: string;
  readonly range: SourceRange;
}

/**
 * `env { name = "DEAL_EVENTS_TOPIC" value = google_pubsub_topic.deal_events.name }` — a container
 * environment variable whose value REFERENCES a resource this configuration declares.
 *
 * Both halves must be stated: a literal variable name, and a reference (not a literal, not an
 * interpolation) as the value. `value = "deal-events"` states a string that happens to look like a
 * topic and is deliberately not recorded — nothing connects it to a resource. `value =
 * "${google_pubsub_topic.x.name}-dlq"` interpolates, so the value is unknowable without running
 * Terraform (PRD §35) and it is skipped too.
 */
export interface TerraformEnvBinding {
  readonly envName: string;
  /** The Terraform address the value refers to, e.g. `google_pubsub_topic.deal_events`. */
  readonly address: string;
  readonly range: SourceRange;
}

export interface TerraformBlock {
  /** The block's leading keyword: `resource`, `module`, `variable`, `output`, `provider`, … */
  readonly kind: string;
  readonly labels: readonly string[];
  readonly range: SourceRange;
  /** Top-level attributes only, first occurrence wins. */
  readonly attributes: ReadonlyMap<string, TerraformAttribute>;
  /** Addresses referenced anywhere in the block, nested blocks and interpolations included. */
  readonly references: readonly TerraformReference[];
  /** Literal `secret_id`/`secret` attributes anywhere in the block (PRD §15.2 secret bindings). */
  readonly secrets: readonly TerraformSecretRef[];
  /** Attributes whose value interpolates — recorded so "unknown" is visible, not silent. */
  readonly unresolved: readonly TerraformUnresolved[];
  /** `env { … }` blocks at any depth whose value references a declared resource. */
  readonly envBindings: readonly TerraformEnvBinding[];
}

/** Bound on one block's subtree: a hostile `.tf` costs a truncated read, never the run (§42.5). */
const MAX_BLOCK_NODES = 5000;

const SECRET_ATTRIBUTES = new Set(['secret_id', 'secret']);

interface BlockScan {
  readonly references: TerraformReference[];
  readonly secrets: TerraformSecretRef[];
  readonly unresolved: TerraformUnresolved[];
  readonly envBindings: TerraformEnvBinding[];
}

const attributeName = (attribute: Node): string | undefined =>
  namedChildrenOf(attribute).find((child) => child.type === 'identifier')?.text;

const attributeExpression = (attribute: Node): Node | undefined =>
  namedChildrenOf(attribute).find((child) => child.type === 'expression');

const scanAttribute = (attribute: Node, scan: BlockScan): void => {
  const name = attributeName(attribute);
  const expression = attributeExpression(attribute);
  if (name === undefined || expression === undefined) {
    return;
  }
  const value = readLiteral(expression);
  if (value.interpolated) {
    scan.unresolved.push({ name, range: rangeOfNode(attribute) });
    return;
  }
  if (value.literal !== undefined && value.literal !== '' && SECRET_ATTRIBUTES.has(name)) {
    scan.secrets.push({ value: value.literal, range: rangeOfNode(attribute) });
  }
};

const ENV_BLOCK = 'env';

interface EnvAttributes {
  envName: string | undefined;
  reference: TerraformReference | undefined;
}

/** First `name` (a literal) and first `value` (a reference) of an `env` body; nothing else. */
const readEnvAttribute = (child: Node, into: EnvAttributes): void => {
  const name = child.type === 'attribute' ? attributeName(child) : undefined;
  const expression = child.type === 'attribute' ? attributeExpression(child) : undefined;
  if (name === undefined || expression === undefined) {
    return;
  }
  if (name === 'name' && into.envName === undefined) {
    into.envName = readLiteral(expression).literal;
  }
  if (name === 'value' && into.reference === undefined) {
    into.reference = readReference(expression);
  }
};

/** The `name`/`value` pair of an `env { … }` block, when both are stated the required way. */
const envBindingOf = (block: Node): TerraformEnvBinding | undefined => {
  const children = namedChildrenOf(block);
  const keyword = children[0];
  if (keyword?.type !== 'identifier' || keyword.text !== ENV_BLOCK) {
    return undefined;
  }
  const body = children.find((child) => child.type === 'body');
  const found: EnvAttributes = { envName: undefined, reference: undefined };
  for (const child of body === undefined ? [] : namedChildrenOf(body)) {
    readEnvAttribute(child, found);
  }
  const { envName, reference } = found;
  return envName === undefined || envName === '' || reference === undefined
    ? undefined
    : { envName, address: reference.address, range: rangeOfNode(block) };
};

/** One bounded walk of a block body collecting every fact that can appear at any depth. */
const scanBody = (body: Node): BlockScan => {
  const scan: BlockScan = { references: [], secrets: [], unresolved: [], envBindings: [] };
  const stack: Node[] = [body];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_BLOCK_NODES) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visited += 1;
    if (node.type === 'expression') {
      const reference = readReference(node);
      if (reference !== undefined) {
        scan.references.push(reference);
      }
    } else if (node.type === 'attribute') {
      scanAttribute(node, scan);
    } else if (node.type === 'block') {
      const binding = envBindingOf(node);
      if (binding !== undefined) {
        scan.envBindings.push(binding);
      }
    }
    stack.push(...namedChildrenOf(node));
  }
  return scan;
};

const topLevelAttributes = (body: Node | undefined): ReadonlyMap<string, TerraformAttribute> => {
  const map = new Map<string, TerraformAttribute>();
  for (const child of body === undefined ? [] : namedChildrenOf(body)) {
    const name = child.type === 'attribute' ? attributeName(child) : undefined;
    const expression = child.type === 'attribute' ? attributeExpression(child) : undefined;
    if (name === undefined || expression === undefined || map.has(name)) {
      continue;
    }
    const value = readLiteral(expression);
    const integer = readIntegerLiteral(expression);
    map.set(name, {
      range: rangeOfNode(child),
      interpolated: value.interpolated,
      ...(value.literal === undefined ? {} : { literal: value.literal }),
      ...(integer === undefined ? {} : { integer }),
    });
  }
  return map;
};

const BLOCK_STRUCTURE = new Set(['block_start', 'block_end', 'body']);

/** Labels sit between the block keyword and its body: `resource "type" "name" {`. */
const readLabels = (block: Node): readonly string[] => {
  const labels: string[] = [];
  for (const child of namedChildrenOf(block).slice(1)) {
    if (BLOCK_STRUCTURE.has(child.type)) {
      break;
    }
    const value = child.type === 'string_lit' ? readLiteral(child).literal : child.text;
    if (value !== undefined && value !== '') {
      labels.push(value);
    }
  }
  return labels;
};

const EMPTY_SCAN: BlockScan = { references: [], secrets: [], unresolved: [], envBindings: [] };

const readBlock = (block: Node): TerraformBlock | undefined => {
  const children = namedChildrenOf(block);
  const keyword = children[0];
  if (keyword?.type !== 'identifier') {
    return undefined;
  }
  const body = children.find((child) => child.type === 'body');
  const scan = body === undefined ? EMPTY_SCAN : scanBody(body);
  return {
    kind: keyword.text,
    labels: readLabels(block),
    range: rangeOfNode(block),
    attributes: topLevelAttributes(body),
    references: scan.references,
    secrets: scan.secrets,
    unresolved: scan.unresolved,
    envBindings: scan.envBindings,
  };
};

/** A top-level `name = <value>` assignment, which is what a `.tfvars` file consists of. */
export interface TerraformAssignment {
  readonly name: string;
  readonly range: SourceRange;
}

export interface TerraformDocument {
  readonly blocks: readonly TerraformBlock[];
  /** Non-empty only for `.tfvars`; a `.tf` file's top-level content is blocks. */
  readonly assignments: readonly TerraformAssignment[];
}

/**
 * Top-level contents of one parsed Terraform file, in document order. A file whose root carries
 * an error-recovery node instead of a body yields nothing here — the caller still records the
 * file and the parser's own warning (PRD §34).
 */
export const readTerraformDocument = (root: Node): TerraformDocument => {
  const body = namedChildrenOf(root).find((child) => child.type === 'body');
  const blocks: TerraformBlock[] = [];
  const assignments: TerraformAssignment[] = [];
  for (const child of body === undefined ? [] : namedChildrenOf(body)) {
    const block = child.type === 'block' ? readBlock(child) : undefined;
    const name = child.type === 'attribute' ? attributeName(child) : undefined;
    if (block !== undefined) {
      blocks.push(block);
    } else if (name !== undefined) {
      assignments.push({ name, range: rangeOfNode(child) });
    }
  }
  return { blocks, assignments };
};
