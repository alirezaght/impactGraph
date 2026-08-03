import { decoratorEvidence } from './python-context.js';
import { callArguments, dottedName } from './python-syntax.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

// Decorators are raw material for framework enrichment (PRD §31) — the language adapter records
// them, framework adapters interpret them. `decoratorName` keeps the dotted source form
// (`router.get`, `app.on_event`, `staticmethod`) so a framework adapter can split receiver from
// method without re-parsing.

const decoratorParts = (decorator: Node): { name: string; args: Node | undefined } | undefined => {
  const target = decorator.namedChild(0);
  if (target === null) {
    return undefined;
  }
  if (target.type === 'call') {
    const callee = target.childForFieldName('function');
    const name = callee === null ? undefined : dottedName(callee);
    return name === undefined
      ? undefined
      : { name, args: target.childForFieldName('arguments') ?? undefined };
  }
  const name = dottedName(target);
  return name === undefined ? undefined : { name, args: undefined };
};

/** Record every `@decorator` sitting on a decorated definition, bound to the symbol it decorates. */
export const collectDecorators = (
  state: PythonParseState,
  decorators: readonly Node[],
  targetNodeId: string,
): void => {
  for (const decorator of decorators) {
    const parts = decoratorParts(decorator);
    if (parts === undefined) {
      state.builder.warn(state.filePath, `unreadable decorator on ${targetNodeId} — skipped`);
      continue;
    }
    const evidenceId = decoratorEvidence(state, decorator, parts.name);
    if (evidenceId === undefined) {
      continue;
    }
    const args = callArguments(parts.args);
    state.builder.addDecorator({
      targetNodeId,
      decoratorName: parts.name,
      stringArguments: args.strings,
      identifierLists: {
        arguments: args.identifiers,
        ...Object.fromEntries(
          Object.entries(args.keywordIdentifiers).map(([key, value]) => [key, [value]]),
        ),
      },
      filePath: state.filePath,
      evidenceId,
    });
  }
};
