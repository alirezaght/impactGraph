import {
  confidenceLabel,
  presentationForCategory,
  presentationForProvenance,
} from '../provenance.js';

import type { JSX } from 'react';

// PRD §3/§37 — the reusable colour-independent indicators. Every badge renders TEXT, carries a
// data attribute for tests, and sets a border style; colour is optional decoration on top.

export const KnowledgeBadge = ({
  provenance,
  category,
}: {
  readonly provenance?: string | undefined;
  readonly category?: string | undefined;
}): JSX.Element => {
  const presentation =
    category === undefined
      ? presentationForProvenance(provenance)
      : presentationForCategory(category);
  return (
    <span
      className={`badge badge--${presentation.key}`}
      data-knowledge-category={presentation.key}
      data-border-style={presentation.borderStyle}
      title={presentation.label}
      aria-label={presentation.label}
    >
      {presentation.badge}
    </span>
  );
};

/** Confidence as a number + word (§37). Absent confidence says so; it never renders as 100%. */
export const ConfidenceText = ({
  confidence,
}: {
  readonly confidence?: number | undefined;
}): JSX.Element => <span className="confidence">{confidenceLabel(confidence)}</span>;

export const SeverityText = ({ severity }: { readonly severity: string }): JSX.Element => (
  <span className="severity" data-severity={severity}>
    severity: {severity}
  </span>
);

export const Absent = ({ what }: { readonly what: string }): JSX.Element => (
  <p className="absent">{what} — not reported by the analysis.</p>
);
