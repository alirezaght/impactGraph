// PRD §12.3 — the seven provenance values, and their derived knowledge categories (PRD §3,
// ADR-0002). Category is derived, never stored (docs/engineering/provenance-model.md).
export const PROVENANCE_VALUES = [
  'static-analysis',
  'configuration',
  'human-confirmed',
  'llm-inferred',
  'git-history',
  'framework-convention',
  'runtime-observation',
] as const;

export type Provenance = (typeof PROVENANCE_VALUES)[number];

export type KnowledgeCategory = 'deterministic' | 'ai-inferred' | 'human-confirmed' | 'reserved';

const CATEGORY_BY_PROVENANCE: Record<Provenance, KnowledgeCategory> = {
  'static-analysis': 'deterministic',
  configuration: 'deterministic',
  'git-history': 'deterministic',
  'framework-convention': 'deterministic',
  'llm-inferred': 'ai-inferred',
  'human-confirmed': 'human-confirmed',
  // Reserved for future support (PRD §12.3); no V1 code path may produce it.
  'runtime-observation': 'reserved',
};

export const isProvenance = (value: unknown): value is Provenance =>
  typeof value === 'string' && (PROVENANCE_VALUES as readonly string[]).includes(value);

export const knowledgeCategoryOf = (provenance: Provenance): KnowledgeCategory =>
  CATEGORY_BY_PROVENANCE[provenance];
