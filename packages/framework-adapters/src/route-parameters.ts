import type { RouteParameter, Requiredness } from '@impactgraph/domain';

// §12.1.1 path-parameter extraction. One function per SYNTAX, not per framework, because what can be
// observed is a property of the notation a route path is written in — and requiredness is recorded
// only where that notation states it.
//
// The rule this file exists to hold: a dynamic segment is not a required parameter. Those are
// different claims, and only some notations make the second one.

/**
 * The path notations this codebase can read.
 *
 * - `colon` — Express and NestJS: `/deals/:id`, and `/deals/:id?` for an optional segment. The `?`
 *   suffix is part of the path syntax the router itself parses, so requiredness is observable.
 * - `brace` — Spring and FastAPI: `/deals/{id}`. The placeholder states that the segment is dynamic
 *   and nothing more. In Spring, optionality lives in `@PathVariable(required = false)`; in FastAPI
 *   it lives in the handler signature's default value. Neither is read here, so requiredness is
 *   `unknown` — and it must stay `unknown` until a producer actually reads one of them.
 * - `bracket` — Astro file routing: `src/pages/deals/[id].astro` and `[...rest].astro`. A rest
 *   parameter matches zero or more segments, which is the framework's own definition of optional, so
 *   both states are observable from the filename alone.
 */
export type PathSyntax = 'colon' | 'brace' | 'bracket';

interface SyntaxRule {
  /** Captures the parameter name in group 1 and any optionality marker in group 2. */
  readonly pattern: RegExp;
  readonly requirednessOf: (marker: string | undefined) => Requiredness;
}

const RULES: Readonly<Record<PathSyntax, SyntaxRule>> = {
  // `:id` / `:id?`. The name stops at the next `/`, `.`, or `-` so `/deals/:id.json` reads as `id`.
  colon: {
    pattern: /:([A-Za-z_$][\w$]*)(\?)?/g,
    requirednessOf: (marker) => (marker === '?' ? 'optional' : 'required'),
  },
  // `{id}` — deliberately no optionality branch. There is no marker to read.
  brace: {
    pattern: /\{([^{}/]+)\}/g,
    requirednessOf: () => 'unknown',
  },
  // `[id]` / `[...rest]`. The spread is captured, not stripped, because it IS the signal.
  bracket: {
    pattern: /\[(\.\.\.)?([^[\]/]+)\]/g,
    requirednessOf: (marker) => (marker === '...' ? 'optional' : 'required'),
  },
};

/**
 * Parameters declared in a route path, in declaration order, with duplicates collapsed.
 *
 * A path with no dynamic segments yields an empty list, and that emptiness IS an observation: the
 * producer read the whole path and found none. This differs from a migrated v1 node, whose empty
 * list means the evidence was never recorded — which is why that case carries a diagnostic.
 */
export const pathParametersOf = (path: string, syntax: PathSyntax): RouteParameter[] => {
  const rule = RULES[syntax];
  const byName = new Map<string, RouteParameter>();
  for (const match of path.matchAll(rule.pattern)) {
    // Bracket syntax puts the marker first (`[...rest]`), the others put it last (`:id?`).
    const [name, marker] = syntax === 'bracket' ? [match[2], match[1]] : [match[1], match[2]];
    const trimmed = name?.trim() ?? '';
    if (trimmed === '' || byName.has(trimmed)) {
      continue;
    }
    byName.set(trimmed, { name: trimmed, requiredness: rule.requirednessOf(marker) });
  }
  return [...byName.values()];
};

/**
 * Query parameters are NOT derived here, and no producer supplies them today.
 *
 * A route path never contains them — `?limit=10` is an argument to an endpoint, not part of its
 * declaration (see `normalizeRoutePath`, which drops the query string for exactly that reason).
 * Where a framework does declare them they live somewhere this layer does not look: a FastAPI
 * handler's non-path signature parameters, or Spring's `@RequestParam`. Until a producer reads one
 * of those, every `queryParameters` array is empty because nothing was observed — so no rule may
 * treat an empty array as "this endpoint accepts no query parameters".
 */
export const NO_QUERY_PARAMETERS: readonly RouteParameter[] = [];
