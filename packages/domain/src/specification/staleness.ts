// Story 5.4 — analysis staleness (regeneration hint). Staleness is DERIVED, never written:
// mutating a specification leaves every stored analysis untouched (append-only, §40.2/§40.3);
// readers compare versions at display time and flag, never silently refresh (main skill §3).

/** The minimal shape an analysis needs to be checked for staleness. */
export interface AnalysisVersionRef {
  readonly specificationVersion: number;
}

/** An analysis is stale when the specification has moved past the version it was built from. */
export const isAnalysisStale = (
  analysis: AnalysisVersionRef,
  currentSpecificationVersion: number,
): boolean => analysis.specificationVersion < currentSpecificationVersion;
