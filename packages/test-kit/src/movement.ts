// Movement classification between a committed golden and a fresh run (PRD §42.3 support).
//
// A pass/fail on golden text says only "something changed". These reports say WHAT changed, in
// categories a reviewer can accept or reject: a vocabulary migration should show relationship
// changes and nothing else, a propagation change should show tier moves and nothing else. Keeping
// them apart is what lets a tier move be attributed to better graph data or to a new obligation
// rule, never ambiguously to both.
//
// Identity is semantic and excludes every field being compared. Including tier or confidence in a
// candidate's identity would make a promotion look like one removal plus one addition, which is the
// specific failure this module exists to avoid.

export type CandidateMovement =
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'promoted'
  | 'demoted'
  | 'relationship-changed'
  | 'confidence-changed'
  | 'explanation-changed';

export type GraphMovement =
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'relationship-changed'
  | 'direction-changed'
  | 'provenance-changed'
  | 'evidence-changed'
  /** Two candidates matched the same fallback key, so no honest classification is possible. */
  | 'unmatched-ambiguous';

export interface MovementReport {
  readonly totals: Readonly<Record<string, number>>;
  /** Per-category breakdown, e.g. promoted → { 'possible → likely': 3 }. */
  readonly detail: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

interface Counters {
  readonly totals: Record<string, number>;
  readonly detail: Record<string, Record<string, number>>;
}

const newCounters = (): Counters => ({ totals: {}, detail: {} });

const count = (counters: Counters, category: string, key?: string): void => {
  counters.totals[category] = (counters.totals[category] ?? 0) + 1;
  if (key !== undefined) {
    const bucket = (counters.detail[category] ??= {});
    bucket[key] = (bucket[key] ?? 0) + 1;
  }
};

const freeze = (counters: Counters): MovementReport => ({
  totals: counters.totals,
  detail: counters.detail,
});

// ---------------------------------------------------------------------------- candidates

interface CandidateRow {
  readonly likelihood: string;
  readonly confidence: string;
  readonly relationship: string;
  readonly explanation: string;
}

const TIER_RANK: Readonly<Record<string, number>> = {
  required: 3,
  likely: 2,
  possible: 1,
  unlikely: 0,
};

/**
 * `requirementId|name|likelihood|type|directness|confidence|relationship|explanationHash|signals`
 * Identity is the first two fields only.
 */
export const parseCandidateGolden = (text: string): Map<string, CandidateRow> => {
  const rows = new Map<string, CandidateRow>();
  for (const line of text.split('\n')) {
    const parts = line.split('|');
    if (parts.length >= 9 && parts[0]?.startsWith('req-') === true) {
      rows.set(`${parts[0]}|${parts[1] ?? ''}`, {
        likelihood: parts[2] ?? '',
        confidence: parts[5] ?? '',
        relationship: parts[6] ?? '',
        explanation: parts[7] ?? '',
      });
    }
  }
  return rows;
};

/** One category per candidate, most significant change first. */
const classifyCandidate = (counters: Counters, before: CandidateRow, after: CandidateRow): void => {
  const delta = (TIER_RANK[after.likelihood] ?? -1) - (TIER_RANK[before.likelihood] ?? -1);
  if (delta !== 0) {
    count(
      counters,
      delta > 0 ? 'promoted' : 'demoted',
      `${before.likelihood} → ${after.likelihood} (${after.relationship})`,
    );
    return;
  }
  if (before.relationship !== after.relationship) {
    count(counters, 'relationship-changed', `${before.relationship} → ${after.relationship}`);
    return;
  }
  if (before.confidence !== after.confidence) {
    count(counters, 'confidence-changed', `${before.confidence} → ${after.confidence}`);
    return;
  }
  // Not collapsed into unchanged: a stable tier over a changed explanation means the evidence model
  // moved, which a reviewer should see.
  count(counters, before.explanation === after.explanation ? 'unchanged' : 'explanation-changed');
};

export const candidateMovement = (
  before: ReadonlyMap<string, CandidateRow>,
  after: ReadonlyMap<string, CandidateRow>,
): MovementReport => {
  const counters = newCounters();
  for (const [key, row] of after) {
    const baseline = before.get(key);
    if (baseline === undefined) {
      count(counters, 'added', key);
      continue;
    }
    classifyCandidate(counters, baseline, row);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      count(counters, 'removed', key);
    }
  }
  return freeze(counters);
};

// ---------------------------------------------------------------------------- graph edges

interface EdgeRow {
  readonly relationship: string;
  readonly source: string;
  readonly target: string;
  readonly provenance: string;
  readonly evidence: string;
}

/** `relationship|source->target|provenance|evN` */
const parseEdgeLine = (line: string): EdgeRow | undefined => {
  const parts = line.split('|');
  if (parts.length < 4 || parts[1]?.includes('->') !== true) {
    return undefined;
  }
  const [source, target] = (parts[1] ?? '').split('->');
  return {
    relationship: parts[0] ?? '',
    source: source ?? '',
    target: target ?? '',
    provenance: parts[2] ?? '',
    evidence: parts[3] ?? '',
  };
};

export const parseGraphGolden = (text: string): EdgeRow[] => {
  const rows: EdgeRow[] = [];
  let inEdges = false;
  for (const line of text.split('\n')) {
    if (line === 'edges:') {
      inEdges = true;
      continue;
    }
    const row = inEdges ? parseEdgeLine(line) : undefined;
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return rows;
};

/** Exact identity: same relationship AND same orientation. */
const primaryKey = (row: EdgeRow): string => `${row.relationship}|${row.source}->${row.target}`;

/**
 * Fallback identity: the pair of endpoints, unordered, ignoring relationship. This is what lets a
 * reversed edge be reported as `direction-changed` instead of one removal plus one addition, and a
 * retyped edge as `relationship-changed`.
 */
const fallbackKey = (row: EdgeRow): string => [row.source, row.target].sort().join('~');

const compareMatched = (counters: Counters, before: EdgeRow, after: EdgeRow): void => {
  if (before.source !== after.source) {
    count(
      counters,
      'direction-changed',
      `${before.relationship} ${before.source}→${before.target}`,
    );
    return;
  }
  if (before.relationship !== after.relationship) {
    count(counters, 'relationship-changed', `${before.relationship} → ${after.relationship}`);
    return;
  }
  if (before.provenance !== after.provenance) {
    count(counters, 'provenance-changed', `${before.provenance} → ${after.provenance}`);
    return;
  }
  count(
    counters,
    before.evidence === after.evidence ? 'unchanged' : 'evidence-changed',
    before.evidence === after.evidence ? undefined : `${before.evidence} → ${after.evidence}`,
  );
};

const groupBy = (
  rows: readonly EdgeRow[],
  key: (row: EdgeRow) => string,
): Map<string, EdgeRow[]> => {
  const groups = new Map<string, EdgeRow[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row));
    if (bucket === undefined) {
      groups.set(key(row), [row]);
    } else {
      bucket.push(row);
    }
  }
  return groups;
};

/**
 * Two-stage match. Anything that survives both stages is a genuine addition or removal; anything
 * whose fallback bucket holds more than one row on either side is reported as ambiguous rather than
 * paired by guesswork, because a plausible-looking but wrong pairing is worse than no answer.
 */
/** Stage two: pair what exact identity could not, or report that pairing is not possible. */
const matchByEndpoints = (
  counters: Counters,
  unmatchedBefore: readonly EdgeRow[],
  unmatchedAfter: readonly EdgeRow[],
): Set<EdgeRow> => {
  const beforeFallback = groupBy(unmatchedBefore, fallbackKey);
  const paired = new Set<EdgeRow>();
  for (const [key, rows] of groupBy(unmatchedAfter, fallbackKey)) {
    const candidates = beforeFallback.get(key) ?? [];
    if (candidates.length === 0) {
      rows.forEach((row) => count(counters, 'added', primaryKey(row)));
      continue;
    }
    if (candidates.length > 1 || rows.length > 1) {
      // Cannot say which became which, so say that instead of guessing.
      rows.forEach(() => count(counters, 'unmatched-ambiguous', key));
      candidates.forEach((candidate) => paired.add(candidate));
      continue;
    }
    const [before] = candidates;
    const [after] = rows;
    if (before !== undefined && after !== undefined) {
      paired.add(before);
      compareMatched(counters, before, after);
    }
  }
  return paired;
};

export const graphMovement = (
  beforeRows: readonly EdgeRow[],
  afterRows: readonly EdgeRow[],
): MovementReport => {
  const counters = newCounters();
  const beforeExact = groupBy(beforeRows, primaryKey);
  const usedBefore = new Set<EdgeRow>();
  const unmatchedAfter: EdgeRow[] = [];

  for (const row of afterRows) {
    const candidates = beforeExact.get(primaryKey(row)) ?? [];
    const match = candidates.find((candidate) => !usedBefore.has(candidate));
    if (match === undefined) {
      unmatchedAfter.push(row);
      continue;
    }
    usedBefore.add(match);
    compareMatched(counters, match, row);
  }

  const unmatchedBefore = beforeRows.filter((row) => !usedBefore.has(row));
  const pairedBefore = matchByEndpoints(counters, unmatchedBefore, unmatchedAfter);

  for (const row of unmatchedBefore) {
    if (!pairedBefore.has(row)) {
      count(counters, 'removed', primaryKey(row));
    }
  }
  return freeze(counters);
};

/** Sums several per-fixture reports into one, so an acceptance record covers the whole suite. */
export const mergeMovement = (reports: readonly MovementReport[]): MovementReport => {
  const counters = newCounters();
  for (const report of reports) {
    for (const [category, total] of Object.entries(report.totals)) {
      counters.totals[category] = (counters.totals[category] ?? 0) + total;
      for (const [key, value] of Object.entries(report.detail[category] ?? {})) {
        const bucket = (counters.detail[category] ??= {});
        bucket[key] = (bucket[key] ?? 0) + value;
      }
    }
  }
  return freeze(counters);
};

/** Human-readable form for the console, per the agreed acceptance-record layout. */
export const formatMovement = (label: string, report: MovementReport): string => {
  const lines = [`${label}`];
  for (const [category, total] of Object.entries(report.totals).sort()) {
    lines.push(`  ${category}: ${String(total)}`);
    for (const [key, value] of Object.entries(report.detail[category] ?? {}).sort()) {
      lines.push(`    ${key}: ${String(value)}`);
    }
  }
  return lines.join('\n');
};
