import type { ComponentSearchHit } from './component-search-scoring.js';

/**
 * What the caller is trying to DO, which decides what a good result looks like.
 *
 * A conceptual query for implementation work returned test files in eight of its top ten results,
 * and a query about architecture rules returned eleven fields of one interface from one file. Both
 * were "correct" by relevance: the tests really do mention the concept, and the interface really
 * does have eleven matching fields. Neither was useful, because ranking had no idea what the answer
 * was for.
 *
 * This stays deliberately small. Component discovery is not where ImpactGraph earns its keep —
 * grep, LSPs and code-exploration agents already do it well — so the goal here is to stop the two
 * observed pathologies, not to build a relevance model.
 */
export const QUERY_INTENTS = [
  'architecture',
  'planning',
  'implementation',
  'validation',
  'tests',
  'runtime',
  'ownership',
] as const;

export type QueryIntent = (typeof QUERY_INTENTS)[number];

const INTENT_PATTERNS: readonly { readonly intent: QueryIntent; readonly pattern: RegExp }[] = [
  { intent: 'validation', pattern: /\b(guard|invariant|constraint|rule|enforce|ci check|lint|policy|allowlist|forbidden)\b/i },
  { intent: 'tests', pattern: /\b(test|spec|fixture|golden|assertion|coverage)\b/i },
  { intent: 'runtime', pattern: /\b(deploy|terraform|cloud run|container|environment variable|env var|gateway|aggregator|topology|infra)\b/i },
  { intent: 'architecture', pattern: /\b(architecture|boundary|layer|module structure|bounded context|dependency direction)\b/i },
  { intent: 'ownership', pattern: /\b(owner|owns|team|responsible|maintainer)\b/i },
  { intent: 'planning', pattern: /\b(plan|impact|affected|change surface|requirement)\b/i },
];

/**
 * Inferred, never assumed. When nothing matches, `implementation` is the default because it is the
 * intent under which a wrong answer is cheapest to notice — production source ranked first is
 * obviously wrong if the caller wanted tests, whereas tests ranked first quietly wastes their time.
 */
export const inferQueryIntent = (query: string): QueryIntent =>
  INTENT_PATTERNS.find((entry) => entry.pattern.test(query))?.intent ?? 'implementation';

const isTest = (hit: ComponentSearchHit): boolean =>
  hit.type === 'test' || /(^|\/)(tests?|__tests__|spec)\//.test(hit.path ?? '') ||
  /\.(test|spec)\.[a-z]+$/.test(hit.path ?? '');

const isGuard = (hit: ComponentSearchHit): boolean =>
  /(^|\/)(ci|scripts)\//.test(hit.path ?? '') ||
  hit.category === 'governance' ||
  /eslint|\.github\/workflows/.test(hit.path ?? '');

const isRuntime = (hit: ComponentSearchHit): boolean =>
  hit.category === 'infrastructure' || /\.tf$|(^|\/)(infra|terraform|deploy)\//.test(hit.path ?? '');

const isFixture = (hit: ComponentSearchHit): boolean => /(^|\/)fixtures?\//.test(hit.path ?? '');

/** Multipliers per intent. Above 1 promotes, below 1 demotes; nothing is ever removed. */
const weightFor = (intent: QueryIntent, hit: ComponentSearchHit): number => {
  if (isFixture(hit)) {
    // Fixtures are sample repositories, not this repository's production surface. They leaked into
    // predictions as "example paths" and read as real answers.
    return 0.4;
  }
  switch (intent) {
    case 'implementation':
    case 'planning':
      return isTest(hit) ? 0.5 : isGuard(hit) ? 0.8 : 1;
    case 'validation':
      return isGuard(hit) ? 1.6 : isTest(hit) ? 1.3 : 1;
    case 'tests':
      return isTest(hit) ? 1.6 : 0.7;
    case 'runtime':
      return isRuntime(hit) ? 1.6 : isTest(hit) ? 0.5 : 1;
    case 'architecture':
      return isGuard(hit) ? 1.3 : isTest(hit) ? 0.6 : 1;
    case 'ownership':
      return 1;
  }
};

/** Results kept per file before the rest are pushed below everything else. */
export const MAX_HITS_PER_FILE = 2;

/**
 * Member-level node types: the ones that come in dozens from a single declaration.
 *
 * The observed pathology was eleven FIELDS of one interface filling a page. It was never a class,
 * a file or a function appearing twice — those are distinct components that happen to share a file,
 * and demoting them would lose real answers. So the cap applies to members only.
 */
const MEMBER_TYPES = new Set([
  'field',
  'column',
  'enum-member',
  'union-literal',
  'translation-key',
  'config-key',
  'method',
]);

/**
 * Cap how many MEMBER results one file may occupy near the top.
 *
 * Without this, a query matching an interface with twelve fields returns twelve results from one
 * file and reports that as a search. The overflow is not dropped — it is moved below the diverse
 * results, so nothing disappears and the first screen answers the question.
 */
const applyFileDiversity = (
  hits: readonly ComponentSearchHit[],
): readonly ComponentSearchHit[] => {
  const perFile = new Map<string, number>();
  const primary: ComponentSearchHit[] = [];
  const overflow: ComponentSearchHit[] = [];
  for (const hit of hits) {
    // Identifier-grade hits, and anything that is not a member, are never capped: demoting the
    // class the caller actually named because two of its siblings scored first would be a worse
    // failure than the one the cap fixes.
    if (
      hit.matchKind === 'exact' ||
      hit.matchKind === 'normalized-name' ||
      !MEMBER_TYPES.has(hit.type)
    ) {
      primary.push(hit);
      continue;
    }
    const key = hit.path ?? hit.nodeId;
    const seen = perFile.get(key) ?? 0;
    perFile.set(key, seen + 1);
    (seen < MAX_HITS_PER_FILE ? primary : overflow).push(hit);
  }
  return [...primary, ...overflow];
};

export interface RankedSearch {
  readonly intent: QueryIntent;
  readonly hits: readonly ComponentSearchHit[];
}

export const rankByIntent = (
  hits: readonly ComponentSearchHit[],
  query: string,
  explicitIntent?: QueryIntent,
): RankedSearch => {
  const intent = explicitIntent ?? inferQueryIntent(query);
  const weighted = hits.map((hit) => ({
    ...hit,
    score: Math.round(Math.min(1, hit.score * weightFor(intent, hit)) * 100) / 100,
  }));
  const sorted = [...weighted].sort(
    (a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId),
  );
  return { intent, hits: applyFileDiversity(sorted) };
};
