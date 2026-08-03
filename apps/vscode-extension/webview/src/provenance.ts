import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import type { KnowledgeCategoryDto } from '@impactgraph/contracts';

// PRD §3 + §37 + §43.6 — the three knowledge categories must be distinguishable WITHOUT colour.
// Every category therefore carries: a text badge, a border style, a node shape, and a
// screen-reader sentence. Colour (if any) is added by the stylesheet on top of these, never
// instead of them. A grayscale screenshot still tells the three apart.

export type KnowledgePresentationKey = KnowledgeCategoryDto | 'unclassified';

export interface KnowledgePresentation {
  readonly key: KnowledgePresentationKey;
  /** Short text badge rendered next to every node/row. */
  readonly badge: string;
  /** Long form for tooltips and screen readers. */
  readonly label: string;
  /** CSS/Cytoscape border style — distinct per category, independent of colour. */
  readonly borderStyle: 'solid' | 'dashed' | 'double';
  /** Cytoscape node shape — a second colour-independent channel. */
  readonly shape: 'round-rectangle' | 'diamond' | 'hexagon' | 'octagon';
}

const PRESENTATIONS: Readonly<Record<KnowledgePresentationKey, KnowledgePresentation>> = {
  deterministic: {
    key: 'deterministic',
    badge: 'FACT',
    label: 'Deterministic fact — derived from static analysis, configuration, or git history',
    borderStyle: 'solid',
    shape: 'round-rectangle',
  },
  'ai-inferred': {
    key: 'ai-inferred',
    badge: 'INFERRED',
    label: 'AI-inferred interpretation — a model proposed this; it is not a verified fact',
    borderStyle: 'dashed',
    shape: 'diamond',
  },
  'human-confirmed': {
    key: 'human-confirmed',
    badge: 'CONFIRMED',
    label: 'Human-confirmed knowledge — a person asserted this, superseding earlier records',
    borderStyle: 'double',
    shape: 'hexagon',
  },
  reserved: {
    key: 'reserved',
    badge: 'RESERVED',
    label: 'Reserved provenance (runtime observation) — not produced by this version',
    borderStyle: 'dashed',
    shape: 'octagon',
  },
  unclassified: {
    key: 'unclassified',
    badge: 'UNCLASSIFIED',
    label: 'Unclassified provenance — the source of this claim is unknown; treat it as unverified',
    borderStyle: 'dashed',
    shape: 'octagon',
  },
};

/**
 * Presentation for a provenance string. An unknown provenance is NEVER shown as a fact — it
 * renders as explicitly unclassified (§43.6: false authority is a failure mode, not a default).
 */
export const presentationForProvenance = (provenance: string | undefined): KnowledgePresentation =>
  PRESENTATIONS[knowledgeCategoryForProvenance(provenance) ?? 'unclassified'];

/** Presentation for a category the host already derived (graph DTO carries it per node). */
export const presentationForCategory = (category: string | undefined): KnowledgePresentation =>
  PRESENTATIONS[
    category !== undefined && category in PRESENTATIONS
      ? (category as KnowledgePresentationKey)
      : 'unclassified'
  ];

export const ALL_PRESENTATIONS: readonly KnowledgePresentation[] = Object.values(PRESENTATIONS);

/** Confidence as text first (§37): the number and a word, never colour alone. */
export const confidenceLabel = (confidence: number | undefined): string => {
  if (confidence === undefined) {
    return 'confidence: not reported';
  }
  const band = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
  return `confidence: ${confidence.toFixed(2)} (${band})`;
};
