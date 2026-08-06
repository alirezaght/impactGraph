import { assessEvidenceQuality, evidenceTypesOf, primaryEvidenceType } from '@impactgraph/domain';

import type { GroupedImpact } from './impact-selection.js';
import type { EvidenceQualityDto, ImpactFilters } from '@impactgraph/contracts';
import type { ImpactAnalysis } from '@impactgraph/domain';

/**
 * The evidence-quality half of the bounded summary (dogfooding item 4): the deterministic verdict
 * over the impacts the default view actually SHOWS, plus the count-bearing limitation strings that
 * replace the old unconditional ones. Derived entirely from stored facts — never model-authored.
 */

export const buildEvidenceQuality = (shown: readonly GroupedImpact[]): EvidenceQualityDto => {
  const verdict = assessEvidenceQuality(
    shown.map(({ impact }) => ({
      likelihood: impact.likelihood,
      primaryBasis: primaryEvidenceType(evidenceTypesOf(impact)),
      hops: Math.max(0, impact.dependencyPath.length - 1),
      tierCapped: impact.tierCappedBy !== undefined,
    })),
  );
  return { status: verdict.status, reasons: [...verdict.reasons], counts: verdict.counts };
};

const countAt = (analysis: ImpactAnalysis, likelihood: string): number =>
  analysis.requirementImpacts.filter((impact) => impact.likelihood === likelihood).length;

/**
 * What this view hid, said only when something WAS hidden and with the count. The old strings
 * fired unconditionally, so "3 lexical matches were excluded" and "nothing was excluded" read
 * identically — which is its own kind of noise.
 */
export const evidenceLimitations = (
  analysis: ImpactAnalysis,
  filters: ImpactFilters | undefined,
): string[] => {
  const limitations: string[] = [];
  const lexicalOnly = countAt(analysis, 'lexical-only');
  if (filters?.includeLexicalOnly !== true && lexicalOnly > 0) {
    limitations.push(
      `${String(lexicalOnly)} lexical-only match(es) were excluded from this view (includeLexicalOnly: true to see them).`,
    );
  }
  const excluded = countAt(analysis, 'excluded');
  if (filters?.includeExcluded !== true && excluded > 0) {
    limitations.push(
      `${String(excluded)} impact(s) excluded by specification non-goals were omitted (includeExcluded: true to see them).`,
    );
  }
  return limitations;
};
