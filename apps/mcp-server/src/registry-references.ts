import { findReferences, searchLiterals } from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';

// find_references / search_literals (§21) — structural reference queries over EXISTING index
// data. The handlers stay thin: the engine already produces exactly the contract shape, coverage
// and scope statements included, so nothing is reinterpreted between the engine and the wire.

const findReferencesHandler: ToolHandler<'find_references'> = async (rootDir, input) => {
  const found = await findReferences(rootDir, {
    query: input.query,
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!found.ok) {
    return found;
  }
  return { ok: true, value: found.value };
};

const searchLiteralsHandler: ToolHandler<'search_literals'> = async (rootDir, input) => {
  const found = await searchLiterals(rootDir, {
    pattern: input.pattern,
    ...(input.regex === undefined ? {} : { regex: input.regex }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!found.ok) {
    return found;
  }
  return { ok: true, value: found.value };
};

export const REFERENCE_HANDLERS = {
  find_references: findReferencesHandler,
  search_literals: searchLiteralsHandler,
} as const;
