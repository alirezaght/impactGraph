import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { EvidenceId, RepositorySnapshotId } from '../ids.js';

// Evidence kinds per docs/engineering/provenance-model.md ("what sort of proof").
// file-presence and symbol-declaration ground facts the indexer observes directly
// (a file existing; a symbol being declared at a range).
export const EVIDENCE_KINDS = [
  'import-statement',
  'call-site',
  'decorator',
  'terraform-resource',
  'co-change-history',
  'config-entry',
  'human-statement',
  'model-output-reference',
  'file-presence',
  'symbol-declaration',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface SourceRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface FileSource {
  readonly kind: 'file';
  readonly filePath: string;
  readonly range?: SourceRange;
  readonly symbolName?: string;
}

export interface ConfigSource {
  readonly kind: 'config';
  readonly filePath: string;
  readonly configKey: string;
}

export interface GitCommitSource {
  readonly kind: 'git-commit';
  readonly commitSha: string;
}

/** Concrete source binding: file range/symbol, config key, or git commit (PRD §18.5). */
export type EvidenceSource = FileSource | ConfigSource | GitCommitSource;

/**
 * How an adapter arrived at a relationship, as typed fields rather than prose.
 *
 * This is diagnostic provenance about the DERIVATION, not domain state needed to interpret the
 * graph: the relationship type on the edge already carries the meaning. It lives on evidence
 * because it changes as scanners improve — putting it in KnowledgeEnvelope would force a graph
 * schema migration every time an adapter learns to classify something it previously could not.
 *
 * Its first purpose is measuring the §12.2.1 split: `originalClassification` records what an edge
 * used to be, so the unknown bucket can be watched shrinking as adapters improve.
 */
/**
 * What a routing producer actually observed at a REFERENCE site, kept as typed fields.
 *
 * This exists because the correspondence between `<form action="/api/deals" method="post">` and a
 * declared `POST /api/deals` used to be reviewable only by re-reading the source: the edge cited
 * evidence from both sides but recorded nothing about how the two were matched. The literal, the
 * normalized form, and the stated verb were observed and then discarded, so no rule could condition
 * on them and no reviewer could see whether a match was exact or the product of normalization.
 *
 * Every field is what the producer read. `method` is absent when the reference states no verb —
 * HTML's GET default is browser behaviour, not something the repository declared.
 */
export interface RouteReference {
  /** The path exactly as written at the reference site, before any normalization. */
  readonly literalPath: string;
  /** The form actually used for matching. Present only when normalization changed the literal. */
  readonly normalizedPath?: string;
  /** The verb stated at the reference site, uppercased. Absent when none was stated. */
  readonly method?: string;
  /** The construct read, e.g. 'a.href', 'form.action', 'fetch-argument'. */
  readonly attribute: string;
  /**
   * Whether the literal was fully known at parse time. `dynamic` marks a reference whose path was
   * assembled at runtime — recorded rather than dropped, so an unmatched reference is visible as
   * "could not be resolved" instead of vanishing.
   */
  readonly resolution: 'static' | 'dynamic';
}

/**
 * What a routing producer actually observed at a REFERENCE site, kept as typed fields.
 *
 * This exists because the correspondence between `<form action="/api/deals" method="post">` and a
 * declared `POST /api/deals` used to be reviewable only by re-reading the source: the edge cited
 * evidence from both sides but recorded nothing about how the two were matched. The literal, the
 * normalized form, and the stated verb were all observed and then discarded, so no rule could
 * condition on them and no reviewer could see whether a match was exact or produced by
 * normalization.
 *
 * Every field is something the producer read. `method` is absent when the reference states no verb —
 * HTML's GET default is browser behaviour, not something the repository declared.
 */
export interface RouteReference {
  /** The path exactly as written at the reference site, before any normalization. */
  readonly literalPath: string;
  /** The form actually used for matching. Present only when normalization changed the literal. */
  readonly normalizedPath?: string;
  /** The verb stated at the reference site, uppercased. Absent when none was stated. */
  readonly method?: string;
  /** The construct read, e.g. 'a.href', 'form.action', 'fetch-argument'. */
  readonly attribute: string;
  /**
   * Whether the literal was fully known at parse time. `dynamic` marks a reference whose path was
   * assembled at runtime — recorded rather than dropped, so an unresolved reference stays visible
   * instead of silently vanishing.
   */
  readonly resolution: 'static' | 'dynamic';
}

export interface EvidenceDerivation {
  /** How the relationship was established, e.g. 'framework-binding', 'constructor-injection'. */
  readonly mechanism: string;
  /** The relationship type produced — an EdgeType name, kept as a string to avoid a cycle. */
  readonly relationship: string;
  /** The adapter or assembly step responsible, so an unknown can be traced to its producer. */
  readonly producer: string;
  /** The type this edge carried before the §12.2.1 split, when it was migrated. */
  readonly originalClassification?: string;
  /** Why a classification could not be made. Required in spirit for USES_UNKNOWN. */
  readonly reason?: string;
  /** §12.1.1 — what a routing producer observed at the reference site. */
  readonly routeReference?: RouteReference;
}

export interface EvidenceRecord {
  readonly id: EvidenceId;
  readonly kind: EvidenceKind;
  readonly source: EvidenceSource;
  /** Optional derivation diagnostics (§12.2.1). Absent on evidence that needs no explanation. */
  readonly derivation?: EvidenceDerivation;
  /** Evidence describes one snapshot, never "the repository now" (provenance-model.md). */
  readonly repositorySnapshotId: RepositorySnapshotId;
  readonly createdAt: string;
}

export interface CreateEvidenceRecordInput {
  readonly id: string;
  readonly kind: string;
  readonly source: EvidenceSource;
  readonly derivation?: EvidenceDerivation;
  readonly repositorySnapshotId: string;
  readonly createdAt: string;
}

export const isValidTimestamp = (value: string): boolean =>
  value.includes('T') && Number.isFinite(Date.parse(value));

export const blankIdIssue = (value: string, path: string): ValidationIssue[] =>
  value.trim().length === 0 ? [validationIssue('blank-id', path, `${path} must not be blank`)] : [];

const rangeIssues = (range: SourceRange, path: string): ValidationIssue[] => {
  const positions = [range.startLine, range.startColumn, range.endLine, range.endColumn];
  if (positions.some((p) => !Number.isInteger(p) || p < 1)) {
    return [validationIssue('invalid-source', path, 'range positions must be integers >= 1')];
  }
  const inverted =
    range.endLine < range.startLine ||
    (range.endLine === range.startLine && range.endColumn < range.startColumn);
  return inverted ? [validationIssue('invalid-source', path, 'range end precedes its start')] : [];
};

const fileSourceIssues = (source: FileSource, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (source.filePath.trim().length === 0) {
    issues.push(
      validationIssue('invalid-source', `${path}.filePath`, 'filePath must not be blank'),
    );
  }
  if (source.range !== undefined) {
    issues.push(...rangeIssues(source.range, `${path}.range`));
  }
  return issues;
};

export const collectSourceIssues = (source: EvidenceSource, path: string): ValidationIssue[] => {
  switch (source.kind) {
    case 'file':
      return fileSourceIssues(source, path);
    case 'config':
      return source.filePath.trim().length === 0 || source.configKey.trim().length === 0
        ? [validationIssue('invalid-source', path, 'config source needs filePath and configKey')]
        : [];
    case 'git-commit':
      return source.commitSha.trim().length === 0
        ? [validationIssue('invalid-source', path, 'git-commit source needs a commit sha')]
        : [];
  }
};

// Records own their data: copy the source so freezing never mutates caller-provided input.
const copySource = (source: EvidenceSource): EvidenceSource => {
  switch (source.kind) {
    case 'file': {
      const base: FileSource = { kind: 'file', filePath: source.filePath };
      const ranged = source.range === undefined ? base : { ...base, range: { ...source.range } };
      return source.symbolName === undefined
        ? ranged
        : { ...ranged, symbolName: source.symbolName };
    }
    case 'config':
      return { kind: 'config', filePath: source.filePath, configKey: source.configKey };
    case 'git-commit':
      return { kind: 'git-commit', commitSha: source.commitSha };
  }
};

const collectEvidenceIssues = (input: CreateEvidenceRecordInput): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.repositorySnapshotId, 'repositorySnapshotId'),
    ...collectSourceIssues(input.source, 'source'),
  ];
  if (!(EVIDENCE_KINDS as readonly string[]).includes(input.kind)) {
    issues.push(
      validationIssue('unknown-evidence-kind', 'kind', `unknown evidence kind '${input.kind}'`),
    );
  }
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(
      validationIssue('invalid-timestamp', 'createdAt', 'createdAt must be an ISO-8601 timestamp'),
    );
  }
  return issues;
};

export const createEvidenceRecord = (
  input: CreateEvidenceRecordInput,
): Result<EvidenceRecord, ValidationError> => {
  const issues = collectEvidenceIssues(input);
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(
    deepFreeze({
      id: input.id as EvidenceId,
      kind: input.kind as EvidenceKind,
      source: copySource(input.source),
      ...(input.derivation === undefined ? {} : { derivation: { ...input.derivation } }),
      repositorySnapshotId: input.repositorySnapshotId as RepositorySnapshotId,
      createdAt: input.createdAt,
    }),
  );
};
