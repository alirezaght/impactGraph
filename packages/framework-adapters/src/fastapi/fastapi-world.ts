import type { CodeGraph } from '../types.js';
import type { CallFact } from '@impactgraph/language-adapters';

// Story 16.2 — what the FastAPI app actually consists of, derived from call facts the Python
// adapter already recorded (PRD §31: enrichment never re-parses source).

/** `<filePath>#<variable>` — the identity of one `FastAPI()` app or `APIRouter()` instance. */
export type HolderKey = string;

export const holderKey = (filePath: string, variable: string): HolderKey =>
  `${filePath}#${variable}`;

export const appNodeId = (key: HolderKey): string => `fastapi:app:${key}`;

export const routerNodeId = (key: HolderKey): string => `fastapi:router:${key}`;

export interface Holder {
  readonly key: HolderKey;
  readonly kind: 'app' | 'router';
  readonly filePath: string;
  readonly variable: string;
  readonly evidenceId: string;
}

export interface Mount {
  readonly parentKey: HolderKey;
  readonly childKey: HolderKey;
  readonly prefix: string;
  readonly evidenceId: string;
}

export interface FastApiWorld {
  readonly holders: ReadonlyMap<HolderKey, Holder>;
  readonly mounts: readonly Mount[];
  /** Full URL prefix for each holder, composed through nested `include_router` calls. */
  readonly prefixes: ReadonlyMap<HolderKey, string>;
  readonly unresolvedMounts: readonly { filePath: string; name: string }[];
}

const CONSTRUCTORS: Readonly<Record<string, 'app' | 'router'>> = {
  FastAPI: 'app',
  APIRouter: 'router',
};

const collectHolders = (graph: CodeGraph): Map<HolderKey, Holder> => {
  const holders = new Map<HolderKey, Holder>();
  for (const fact of graph.callFacts) {
    const kind = CONSTRUCTORS[fact.calleeName];
    if (kind === undefined || fact.assignedTo === undefined || fact.receiverName !== undefined) {
      continue;
    }
    const key = holderKey(fact.filePath, fact.assignedTo);
    holders.set(key, {
      key,
      kind,
      filePath: fact.filePath,
      variable: fact.assignedTo,
      evidenceId: fact.evidenceId,
    });
  }
  return holders;
};

/**
 * Resolve the router handed to `include_router(x, …)` — a local holder, or the graph's own
 * symbol resolution.
 *
 * This used to carry a third path: when the import was aliased
 * (`from app.routers.deals import router as deals_router`) symbol resolution could not bind, so
 * the adapter fell back to the import SPECIFIER and took the first router holder declared in that
 * module. Assembly now translates a local alias back to the exported name (epic-16 line 140), so
 * that fallback is redundant — and it was worse than redundant: with two routers in one module it
 * picked whichever was declared first, regardless of which name was actually imported. Precise
 * resolution or nothing; a router this adapter cannot bind is reported, never guessed.
 */
const resolveMountedRouter = (
  graph: CodeGraph,
  holders: ReadonlyMap<HolderKey, Holder>,
  filePath: string,
  name: string,
): HolderKey | undefined => {
  const local = holders.get(holderKey(filePath, name));
  if (local !== undefined) {
    return local.key;
  }
  const resolved = graph.resolveSymbol(filePath, name);
  if (resolved?.startsWith('symbol:') !== true) {
    return undefined;
  }
  const candidate = resolved.slice('symbol:'.length);
  return holders.has(candidate) ? candidate : undefined;
};

const isMountCall = (fact: CallFact, holders: ReadonlyMap<HolderKey, Holder>): boolean =>
  fact.calleeName === 'include_router' &&
  fact.receiverName !== undefined &&
  holders.has(holderKey(fact.filePath, fact.receiverName));

const prefixOf = (fact: CallFact): string =>
  fact.keywordStringArguments?.['prefix'] ?? fact.stringArguments[0] ?? '';

const composePrefixes = (
  holders: ReadonlyMap<HolderKey, Holder>,
  mounts: readonly Mount[],
): Map<HolderKey, string> => {
  const parentOf = new Map(mounts.map((mount) => [mount.childKey, mount]));
  const prefixes = new Map<HolderKey, string>();
  for (const key of holders.keys()) {
    const parts: string[] = [];
    const seen = new Set<HolderKey>();
    let current = parentOf.get(key);
    while (current !== undefined && !seen.has(current.childKey)) {
      seen.add(current.childKey);
      parts.unshift(current.prefix);
      current = parentOf.get(current.parentKey);
    }
    prefixes.set(key, parts.join(''));
  }
  return prefixes;
};

/** Discover apps, routers, and how they are mounted into one another. */
export const discoverFastApiWorld = (graph: CodeGraph): FastApiWorld => {
  const holders = collectHolders(graph);
  const mounts: Mount[] = [];
  const unresolvedMounts: { filePath: string; name: string }[] = [];
  for (const fact of graph.callFacts) {
    const name = fact.identifierArguments[0];
    if (!isMountCall(fact, holders) || name === undefined || fact.receiverName === undefined) {
      continue;
    }
    const childKey = resolveMountedRouter(graph, holders, fact.filePath, name);
    if (childKey === undefined) {
      unresolvedMounts.push({ filePath: fact.filePath, name });
      continue;
    }
    mounts.push({
      parentKey: holderKey(fact.filePath, fact.receiverName),
      childKey,
      prefix: prefixOf(fact),
      evidenceId: fact.evidenceId,
    });
  }
  return { holders, mounts, prefixes: composePrefixes(holders, mounts), unresolvedMounts };
};
