/**
 * One limitation of the analysis, reported once (ADR-0023).
 *
 * Analysis caveats are properties of the repository and of ImpactGraph's own reach, not of the
 * specification. The runtime checker used to emit one per unresolved deployment chain and tag each
 * with every requirement in the run, so a single pre-existing `local.*_service_url` that Terraform
 * resolution cannot follow appeared as a fresh risk under every requirement — the plan looked
 * dangerous because the tool could not read a file.
 *
 * Collapsing is by SUBJECT, never by requirement: the same unreadable thing is one caveat however
 * many requirements happened to be in the run. The merged caveat states how many instances it
 * stands for, so the count is never silently lost.
 */

import { findingOriginOf } from '@impactgraph/domain';

import type { PreflightFinding } from '@impactgraph/domain';

/**
 * The repository identity of what could not be established. Deliberately excludes requirement ids:
 * including them is exactly the over-attribution this collapse exists to undo.
 */
const subjectKey = (finding: PreflightFinding): string => {
  const subject = finding.subject;
  const parts = [
    finding.kind,
    finding.analyzer,
    subject.runtimePathId ?? '',
    subject.constraintId ?? '',
    subject.assumedSymbol ?? '',
    (subject.filePaths ?? []).join(','),
  ];
  return parts.join('|');
};

/** How many instances a merged caveat stands for, appended so the collapse stays auditable. */
const withInstanceCount = (finding: PreflightFinding, count: number): PreflightFinding =>
  count <= 1
    ? finding
    : {
        ...finding,
        statement: `${finding.statement} (${String(count)} paths share this limitation.)`,
      };

/**
 * Collapse analysis caveats that describe the same repository subject. Plan findings and background
 * conditions pass through untouched — a defect per requirement is genuinely a defect per
 * requirement, and merging those would hide work.
 */
export const collapseAnalysisCaveats = (
  findings: readonly PreflightFinding[],
): readonly PreflightFinding[] => {
  const merged = new Map<string, { finding: PreflightFinding; count: number }>();
  const passthrough: PreflightFinding[] = [];
  for (const finding of findings) {
    if (findingOriginOf(finding) !== 'analysis-caveat') {
      passthrough.push(finding);
      continue;
    }
    const key = subjectKey(finding);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { finding, count: 1 });
    } else {
      merged.set(key, { finding: existing.finding, count: existing.count + 1 });
    }
  }
  return [
    ...passthrough,
    ...[...merged.values()].map((entry) => withInstanceCount(entry.finding, entry.count)),
  ];
};

/**
 * Caveats that differ only by which unreadable expression they stopped at are still one story for
 * the reader: "this deployment topology could not be resolved". Collapsed to a single caveat per
 * analyzer+kind when more than `SPREAD_LIMIT` distinct subjects share it, because listing eleven
 * unresolvable Terraform locals individually is the noise, not the information.
 */
const SPREAD_LIMIT = 3;

export const collapseCaveatSpread = (
  findings: readonly PreflightFinding[],
): readonly PreflightFinding[] => {
  const caveats = findings.filter((finding) => findingOriginOf(finding) === 'analysis-caveat');
  const others = findings.filter((finding) => findingOriginOf(finding) !== 'analysis-caveat');
  const byKind = new Map<string, PreflightFinding[]>();
  for (const caveat of caveats) {
    const key = `${caveat.analyzer}|${caveat.kind}`;
    byKind.set(key, [...(byKind.get(key) ?? []), caveat]);
  }
  const kept: PreflightFinding[] = [];
  for (const group of byKind.values()) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    if (group.length <= SPREAD_LIMIT) {
      kept.push(...group);
      continue;
    }
    kept.push({
      ...first,
      statement: `${first.statement} ${String(group.length - 1)} further ${first.kind} caveat(s) of the same kind were collapsed — this is one limitation of the analysis, not ${String(group.length)} risks in the plan.`,
    });
  }
  return [...others, ...kept];
};
