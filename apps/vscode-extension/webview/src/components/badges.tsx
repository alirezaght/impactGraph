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

/**
 * ADR-0015: the likelihood tier was reduced because its strongest basis did not support a
 * stronger one — stated as TEXT wherever likelihood is shown (§37, never colour-only).
 * Deliberately NOT a `.badge`: the badge system is reserved for the three knowledge categories
 * (§3), and the tier cap is an attribute WITHIN deterministic knowledge.
 */
export const TierCapMarker = ({
  cappedBy,
}: {
  readonly cappedBy?: string | undefined;
}): JSX.Element | null =>
  cappedBy === undefined ? null : (
    <span
      className="tier-cap"
      data-tier-capped-by={cappedBy}
      title={`Likelihood tier capped by ${cappedBy} evidence`}
      aria-label={`Likelihood tier capped: the ${cappedBy} basis does not support a stronger tier`}
    >
      TIER CAPPED: {cappedBy}
    </span>
  );
