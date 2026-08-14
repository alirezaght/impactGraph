import { failWith } from './failure.js';
import { loadFragmentFacts } from './fragment-facts.js';
import { withIndexStore } from './graphs.js';

import type { Failable } from './failure.js';
import type { FragmentFacts } from './fragment-facts.js';
import type { IndexStorePort } from '@impactgraph/application';

// search_literals — "where else does this repository use `= ANY(:ids)`?" answered from the
// string-literal facts the adapters already extracted: call arguments (including keyword
// arguments) and decorator arguments such as @Query SQL. There is deliberately NO full-text
// content index (PRD §33), so the scope statement says exactly what was and was not searched.

export interface LiteralSearchRequest {
  readonly pattern: string;
  readonly regex?: boolean | undefined;
  readonly limit?: number | undefined;
}

export interface LiteralMatch {
  readonly filePath: string;
  readonly ownerKind: 'call' | 'decorator';
  readonly ownerName: string;
  readonly receiver?: string | undefined;
  readonly literal: string;
  readonly truncated: boolean;
  readonly line?: number | undefined;
}

export interface LiteralSearchResult {
  readonly matches: readonly LiteralMatch[];
  readonly totalCount: number;
  readonly matchMode: 'substring' | 'regex';
  readonly snapshotId: string;
  readonly scope: string;
  readonly filesSearched: number;
  readonly filesWithoutCachedFacts: number;
}

const LITERAL_TRUNCATE_AT = 200;
const DEFAULT_LIMIT = 50;

const matcherFor = (request: LiteralSearchRequest): Failable<(value: string) => boolean> => {
  if (request.regex !== true) {
    return { ok: true, value: (candidate) => candidate.includes(request.pattern) };
  }
  try {
    const compiled = new RegExp(request.pattern);
    return { ok: true, value: (candidate) => compiled.test(candidate) };
  } catch (error) {
    return failWith(
      'configurationError',
      `invalid regular expression '${request.pattern}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

interface LiteralSource {
  readonly filePath: string;
  readonly ownerKind: 'call' | 'decorator';
  readonly ownerName: string;
  readonly receiver?: string | undefined;
  readonly literal: string;
  readonly evidenceId: string;
}

const literalSources = (facts: FragmentFacts): LiteralSource[] => {
  const sources: LiteralSource[] = [];
  for (const fact of facts.callFacts) {
    const literals = [...fact.stringArguments, ...Object.values(fact.keywordStringArguments ?? {})];
    for (const literal of literals) {
      sources.push({
        filePath: fact.filePath,
        ownerKind: 'call',
        ownerName: fact.calleeName,
        ...(fact.receiverName === undefined ? {} : { receiver: fact.receiverName }),
        literal,
        evidenceId: fact.evidenceId,
      });
    }
  }
  for (const decorator of facts.decorators) {
    for (const literal of decorator.stringArguments) {
      sources.push({
        filePath: decorator.filePath,
        ownerKind: 'decorator',
        ownerName: decorator.decoratorName,
        literal,
        evidenceId: decorator.evidenceId,
      });
    }
  }
  return sources;
};

const scopeStatement = (snapshotId: string, facts: FragmentFacts): string =>
  `string literals passed as call or decorator arguments at the indexed revision (snapshot ${snapshotId}; facts cached for ${String(facts.filesSearched - facts.filesWithoutCachedFacts)} of ${String(facts.filesSearched)} indexed files) — NOT a full-text search of file contents; a literal outside a call or decorator argument was not searched`;

/** All matching literals, sorted deterministically, truncated visibly — before any limit. */
const collectMatches = (
  facts: FragmentFacts,
  matches: (value: string) => boolean,
): LiteralMatch[] => {
  const all: LiteralMatch[] = [];
  for (const source of literalSources(facts)) {
    if (source.literal.length === 0 || !matches(source.literal)) {
      continue;
    }
    const line = facts.lineByEvidenceId.get(source.evidenceId);
    const truncated = source.literal.length > LITERAL_TRUNCATE_AT;
    all.push({
      filePath: source.filePath,
      ownerKind: source.ownerKind,
      ownerName: source.ownerName,
      ...(source.receiver === undefined ? {} : { receiver: source.receiver }),
      literal: truncated ? source.literal.slice(0, LITERAL_TRUNCATE_AT) : source.literal,
      truncated,
      ...(line === undefined ? {} : { line }),
    });
  }
  all.sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.ownerName.localeCompare(b.ownerName) ||
      a.literal.localeCompare(b.literal),
  );
  return all;
};

const currentSnapshotIdOf = async (store: IndexStorePort): Promise<Failable<string>> => {
  const snapshot = await store.getCurrentSnapshotId();
  if (!snapshot.ok) {
    return failWith('indexingFailure', snapshot.error.message);
  }
  if (snapshot.value === undefined) {
    return failWith(
      'configurationError',
      'no completed index generation — run `impactgraph index` first',
    );
  }
  return { ok: true, value: snapshot.value };
};

export const searchLiteralsInStore = async (
  store: IndexStorePort,
  request: LiteralSearchRequest,
): Promise<Failable<LiteralSearchResult>> => {
  const matcher = matcherFor(request);
  if (!matcher.ok) {
    return matcher;
  }
  const snapshotId = await currentSnapshotIdOf(store);
  if (!snapshotId.ok) {
    return snapshotId;
  }
  const facts = await loadFragmentFacts(store, snapshotId.value);
  if (!facts.ok) {
    return facts;
  }
  const limit = request.limit ?? DEFAULT_LIMIT;
  const all = collectMatches(facts.value, matcher.value);
  return {
    ok: true,
    value: {
      matches: all.slice(0, limit),
      totalCount: all.length,
      matchMode: request.regex === true ? 'regex' : 'substring',
      snapshotId: snapshotId.value,
      scope: scopeStatement(snapshotId.value, facts.value),
      filesSearched: facts.value.filesSearched,
      filesWithoutCachedFacts: facts.value.filesWithoutCachedFacts,
    },
  };
};

export const searchLiterals = (
  rootDir: string,
  request: LiteralSearchRequest,
): Promise<Failable<LiteralSearchResult>> =>
  withIndexStore(rootDir, (store) => searchLiteralsInStore(store, request));
