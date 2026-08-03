/**
 * Deterministic reporting for the effective-LOC checker: results are sorted
 * by path, text and JSON output shapes are stable so CI logs and tooling can
 * rely on them.
 */
export interface FileLocResult {
  /** Repo-root-relative posix path. */
  path: string;
  effectiveLines: number;
  totalLines: number;
  /** Limit applied to this file (default or from a reviewed exception). */
  maxLines: number;
  exceptionApplied: boolean;
}

export interface LocReport {
  checkedFiles: number;
  /** Files whose effective LOC exceeds their limit, sorted by path. */
  violations: FileLocResult[];
}

function byPath(a: FileLocResult, b: FileLocResult): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

export function buildReport(results: readonly FileLocResult[]): LocReport {
  const sorted = [...results].sort(byPath);
  return {
    checkedFiles: sorted.length,
    violations: sorted.filter((result) => result.effectiveLines > result.maxLines),
  };
}

export function formatTextReport(report: LocReport): string {
  const lines = report.violations.map(
    (violation) =>
      `${violation.path}  effective=${violation.effectiveLines}  max=${violation.maxLines}` +
      (violation.exceptionApplied ? '  (exception applied)' : ''),
  );
  lines.push(
    `effective-loc: ${report.violations.length} violation(s), ${report.checkedFiles} file(s) checked`,
  );
  return `${lines.join('\n')}\n`;
}

/** Stable JSON: fixed key order, violations sorted by path, 2-space indent. */
export function formatJsonReport(report: LocReport): string {
  return JSON.stringify(
    {
      checkedFiles: report.checkedFiles,
      violationCount: report.violations.length,
      violations: report.violations.map((violation) => ({
        path: violation.path,
        effectiveLines: violation.effectiveLines,
        totalLines: violation.totalLines,
        maxLines: violation.maxLines,
        exceptionApplied: violation.exceptionApplied,
      })),
    },
    null,
    2,
  );
}
