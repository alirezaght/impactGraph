import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { annotationEvidence } from './java-context.js';

import type { JavaParseState } from './java-context.js';
import type { Node } from 'web-tree-sitter';

// Java annotations are the same raw material as TypeScript decorators and Python decorators
// (PRD §31): the language adapter records them verbatim, framework adapters interpret them.
// `@RequestMapping("/deals")` is a fact; "this class is a Spring controller" is Spring's reading
// of that fact, and lives in packages/framework-adapters.

/** `"deals"` → deals. Handles the grammar's `string_literal` → `string_fragment` nesting. */
const stringValue = (node: Node): string | undefined => {
  if (node.type !== 'string_literal') {
    return undefined;
  }
  const fragment = namedChildrenOf(node).find((child) => child.type === 'string_fragment');
  // An empty string literal has no fragment child — that is still a string argument.
  return fragment?.text ?? '';
};

interface AnnotationArguments {
  readonly strings: string[];
  readonly identifiers: Record<string, string[]>;
}

const readArgument = (argument: Node, into: AnnotationArguments): void => {
  const literal = stringValue(argument);
  if (literal !== undefined) {
    into.strings.push(literal);
    return;
  }
  if (argument.type !== 'element_value_pair') {
    return;
  }
  // `@RequestMapping(path = "/deals", method = RequestMethod.GET)` — named elements.
  const key = fieldNode(argument, 'key')?.text;
  const value = fieldNode(argument, 'value');
  if (key === undefined || value === undefined) {
    return;
  }
  const named = stringValue(value);
  if (named !== undefined) {
    into.strings.push(named);
  }
  into.identifiers[key] = [value.text];
};

const annotationArguments = (args: Node | undefined): AnnotationArguments => {
  const collected: AnnotationArguments = { strings: [], identifiers: {} };
  for (const argument of args === undefined ? [] : namedChildrenOf(args)) {
    readArgument(argument, collected);
  }
  return collected;
};

const ANNOTATION_TYPES = new Set(['annotation', 'marker_annotation']);

/** The `@…` entries inside a declaration's `modifiers` node, if it has one. */
export const annotationsOf = (declaration: Node): readonly Node[] => {
  const modifiers = namedChildrenOf(declaration).find((child) => child.type === 'modifiers');
  return modifiers === undefined
    ? []
    : namedChildrenOf(modifiers).filter((child) => ANNOTATION_TYPES.has(child.type));
};

/** Record every annotation on one declaration, bound to the symbol node it annotates. */
export const collectAnnotations = (
  state: JavaParseState,
  annotations: readonly Node[],
  targetNodeId: string,
): void => {
  for (const annotation of annotations) {
    const name = fieldNode(annotation, 'name')?.text;
    if (name === undefined) {
      state.builder.warn(state.filePath, `unreadable annotation on ${targetNodeId} — skipped`);
      continue;
    }
    const evidenceId = annotationEvidence(state, annotation, name);
    if (evidenceId === undefined) {
      continue;
    }
    const args = annotationArguments(fieldNode(annotation, 'arguments'));
    state.builder.addDecorator({
      targetNodeId,
      decoratorName: name,
      stringArguments: args.strings,
      identifierLists: args.identifiers,
      filePath: state.filePath,
      evidenceId,
    });
  }
};
