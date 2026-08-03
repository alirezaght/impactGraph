// The §3/§43.6 knowledge categories as the HTML export renders them. Extracted into its own
// module so that both halves of the view model — the architecture projection
// (`graph-view-model.ts`) and the impact projection (`graph-impact-model.ts`) — can depend on it
// without depending on each other (`import-x/no-cycle`).

/**
 * The five ways a record can read. `unknown` exists because `knowledgeCategoryForProvenance`
 * returns undefined for an unrecognized provenance and that case must be rendered explicitly
 * rather than defaulting to "deterministic".
 */
export const RENDER_CATEGORIES = [
  'deterministic',
  'ai-inferred',
  'human-confirmed',
  'reserved',
  'unknown',
] as const;

export type RenderCategory = (typeof RENDER_CATEGORIES)[number];

export type CategoryCounts = Readonly<Record<RenderCategory, number>>;

export const emptyCategoryCounts = (): Record<RenderCategory, number> => ({
  deterministic: 0,
  'ai-inferred': 0,
  'human-confirmed': 0,
  reserved: 0,
  unknown: 0,
});
