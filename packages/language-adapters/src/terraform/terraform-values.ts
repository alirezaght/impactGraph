import { namedChildrenOf, rangeOfNode } from '../tree-sitter/syntax.js';

import type { SourceRange } from '@impactgraph/domain';
import type { Node } from 'web-tree-sitter';

// Reading one HCL expression — the only place this adapter looks at a *value*.
//
// The rule that shapes everything here: Terraform is parsed, never evaluated (PRD §35). An
// expression that interpolates (`"gcr.io/${var.project_id}/deals-api:latest"`) therefore has NO
// value as far as this adapter is concerned. It reports that it could not be resolved and moves
// on; it never concatenates the literal halves into a plausible-looking guess.
//
// References are a different matter: `${var.project_id}` may have an unknowable *value*, but the
// fact that it *refers to* `var.project_id` is written down in the source and is read as a fact.

/** A Terraform address referenced from an expression: `var.x`, `module.y`, `<type>.<name>`. */
export interface TerraformReference {
  readonly kind: 'variable' | 'module' | 'resource' | 'data';
  readonly address: string;
  readonly range: SourceRange;
}

/** What one expression says, without evaluating it. */
export interface LiteralRead {
  /** Present only for a quoted string with no interpolation anywhere inside it. */
  readonly literal?: string;
  /** True when the expression interpolates — unknowable without running Terraform. */
  readonly interpolated: boolean;
}

/** One expression is small; the cap only exists so a pathological file cannot spin here. */
const MAX_EXPRESSION_NODES = 500;

const subtree = (root: Node): readonly Node[] => {
  const found: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0 && found.length < MAX_EXPRESSION_NODES) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    found.push(node);
    stack.push(...namedChildrenOf(node));
  }
  return found;
};

/**
 * Read a quoted-string expression's value, or report that there is none to read.
 *
 * Three outcomes: a literal string, an interpolated expression (no literal, flagged), or neither
 * — a reference, a number, an object, a function call. Only the first is ever recorded as a fact.
 */
export const readLiteral = (expression: Node): LiteralRead => {
  const nodes = subtree(expression);
  if (nodes.some((node) => node.type === 'template_interpolation')) {
    return { interpolated: true };
  }
  if (!nodes.some((node) => node.type === 'quoted_template_start')) {
    return { interpolated: false };
  }
  const text = nodes
    .filter((node) => node.type === 'template_literal')
    .sort((a, b) => a.startIndex - b.startIndex)
    .map((node) => node.text)
    .join('');
  return { literal: text, interpolated: false };
};

const WHOLE_NUMBER = /^\d+$/;

/**
 * A whole-number literal written in the source, or undefined for anything else.
 *
 * Reading the digits an author typed is not evaluation (PRD §35): `count = 3` states three, and
 * no provider, variable or function is consulted to learn that. `count = var.enabled ? 1 : 0`
 * has no literal digits to read and therefore yields undefined — the caller reports it unresolved
 * rather than picking a branch.
 */
export const readIntegerLiteral = (expression: Node): number | undefined => {
  const text = expression.text.trim();
  return WHOLE_NUMBER.test(text) ? Number(text) : undefined;
};

const identifierText = (node: Node): string | undefined =>
  namedChildrenOf(node).find((child) => child.type === 'identifier')?.text;

/**
 * Heads that never name something this repository declares: `local`/`each`/`count`/`self`/`path`/
 * `terraform` are language built-ins. Skipping them keeps unresolved-reference warnings
 * meaningful.
 *
 * `data` is deliberately NOT in this set. A `data "google_secret_manager_secret" "x" {}` block IS
 * declared in the configuration and IS indexed as a node, so `data.google_secret_manager_secret.x`
 * names something this repository owns — skipping it was the reason a resource that depends on a
 * data source used to show no edge at all (Story 16.1).
 */
const SKIPPED_HEADS = new Set(['local', 'each', 'count', 'self', 'path', 'terraform']);

/** A `Map` for the §42.5 reason: the head is untrusted text and `__proto__` must miss. */
const KINDS = new Map<string, TerraformReference['kind']>([
  ['data', 'data'],
  ['var', 'variable'],
  ['module', 'module'],
]);

/** A Terraform address without a position — what a chain of dotted segments names, if anything. */
export interface TerraformAddress {
  readonly kind: TerraformReference['kind'];
  readonly address: string;
}

/**
 * The single place that decides what `a.b.c` refers to, shared by the HCL reader and the
 * `.tf.json` reader (epic-16). Two syntaxes, one rule: `google_pubsub_topic.deal_events.name` is
 * head + first segment — Terraform's own two-part resource address, with `.name` an attribute OF
 * that resource — while `data.<type>.<name>` needs two segments, and a language built-in names
 * nothing this repository declares.
 *
 * Exported so the JSON path cannot quietly grow a second, subtly different rule.
 */
export const addressFromSegments = (segments: readonly string[]): TerraformAddress | undefined => {
  const [head, first, second] = segments;
  if (head === undefined || SKIPPED_HEADS.has(head)) {
    return undefined;
  }
  const kind = KINDS.get(head) ?? 'resource';
  if (head === 'data') {
    return first === undefined || second === undefined
      ? undefined
      : { kind, address: `data.${first}.${second}` };
  }
  return first === undefined ? undefined : { kind, address: `${head}.${first}` };
};

/**
 * Read the Terraform address an expression refers to, if it refers to one.
 *
 * The grammar lays a reference out flat under the expression: `variable_expr` (the head) followed
 * by one `get_attr` per `.segment`, so the segments hand straight to `addressFromSegments`.
 */
export const readReference = (expression: Node): TerraformReference | undefined => {
  const children = namedChildrenOf(expression);
  const head = children[0];
  const name = head?.type === 'variable_expr' ? identifierText(head) : undefined;
  if (name === undefined) {
    return undefined;
  }
  // Truncated at the first segment that is not a plain identifier (`local.x[0]`, a splat): a
  // segment the reader cannot name ends the address rather than being skipped over, which would
  // silently join two segments that are not adjacent in the source.
  const segments: string[] = [name];
  for (const attribute of children.filter((child) => child.type === 'get_attr')) {
    const text = identifierText(attribute);
    if (text === undefined) {
      break;
    }
    segments.push(text);
  }
  const found = addressFromSegments(segments);
  return found === undefined ? undefined : { ...found, range: rangeOfNode(expression) };
};
