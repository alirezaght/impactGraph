import { cappedSeverity, createRepositoryConstraint } from '@impactgraph/domain';

import { adrGuidanceRecognizer } from './recognizers/adr-guidance.js';
import { ciWorkflowRecognizer } from './recognizers/ci-workflow.js';
import { guardScriptRecognizer } from './recognizers/guard-script.js';
import { lintBoundariesRecognizer } from './recognizers/lint-boundaries.js';

import type { ConstraintRecognizer, ExtractedConstraint, GuardFile } from './types.js';
import type { EvidenceRecord, Provenance, RepositoryConstraint } from '@impactgraph/domain';

/**
 * Turn the repository's guards into indexed constraints.
 *
 * Ordering of recognizers is irrelevant — each reads a disjoint file shape — but the set is
 * deliberately open: `DEFAULT_RECOGNIZERS` is a list a caller may extend or replace, so a new guard
 * shape never requires touching this orchestrator.
 */

export const DEFAULT_RECOGNIZERS: readonly ConstraintRecognizer[] = [
  lintBoundariesRecognizer,
  guardScriptRecognizer,
  ciWorkflowRecognizer,
  adrGuidanceRecognizer,
];

export interface ExtractConstraintsRequest {
  readonly files: readonly GuardFile[];
  /** Entries already read from `.impactgraph/constraints.yml`, if any. */
  readonly declared?: readonly ExtractedConstraint[];
  readonly repositorySnapshotId: string;
  readonly createdAt: string;
  readonly recognizers?: readonly ConstraintRecognizer[];
  /** Supplies stable ids; the application layer never invents them. */
  readonly nextId: (seed: string) => string;
  readonly nextEvidenceId: (seed: string) => string;
}

export interface ExtractConstraintsResult {
  readonly constraints: readonly RepositoryConstraint[];
  readonly evidence: readonly EvidenceRecord[];
  /** Guards seen but not understood, so coverage of the constraint layer is itself reportable. */
  readonly opaqueGuardPaths: readonly string[];
  /** Constraints rejected by domain validation, with the reason. Never silently dropped. */
  readonly rejected: readonly { readonly name: string; readonly reason: string }[];
}

const provenanceFor = (extracted: ExtractedConstraint): Provenance =>
  extracted.extraction === 'declared' ? 'human-confirmed' : 'static-analysis';

interface Bound {
  readonly constraint: RepositoryConstraint | undefined;
  readonly evidence: EvidenceRecord | undefined;
  readonly rejection: { readonly name: string; readonly reason: string } | undefined;
}

const bind = (
  extracted: ExtractedConstraint,
  filePath: string,
  request: ExtractConstraintsRequest,
): Bound => {
  const seed = `${filePath}:${extracted.recognizer}:${extracted.name}`;
  const evidenceId = request.nextEvidenceId(seed);
  const source = {
    kind: 'file' as const,
    filePath,
    ...(extracted.sourceLine === undefined
      ? {}
      : {
          range: {
            startLine: extracted.sourceLine,
            startColumn: 1,
            endLine: extracted.sourceLine,
            endColumn: 1,
          },
        }),
  };
  const evidence: EvidenceRecord = {
    id: evidenceId as EvidenceRecord['id'],
    kind: 'config-entry',
    source: { kind: 'config', filePath, configKey: extracted.name },
    repositorySnapshotId: request.repositorySnapshotId as EvidenceRecord['repositorySnapshotId'],
    createdAt: request.createdAt,
  };
  const result = createRepositoryConstraint({
    id: request.nextId(seed),
    name: extracted.name,
    kind: extracted.kind,
    // The severity a recognizer proposes is capped by what its extraction may claim, so an
    // unreadable guard can never arrive at `blocking` by way of a producer bug.
    severity: cappedSeverity(extracted.severity, extracted.extraction),
    extraction: extracted.extraction,
    scope: extracted.scope,
    rule: extracted.rule,
    exemptions: extracted.exemptions.map((exemption) => ({ ...exemption, source })),
    source,
    provenance: provenanceFor(extracted),
    evidenceIds: [evidenceId],
    repositorySnapshotId: request.repositorySnapshotId,
    createdAt: request.createdAt,
    ...(extracted.notExtractedReason === undefined
      ? {}
      : { notExtractedReason: extracted.notExtractedReason }),
  });
  if (!result.ok) {
    return {
      constraint: undefined,
      evidence: undefined,
      rejection: {
        name: extracted.name,
        reason: result.error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      },
    };
  }
  return { constraint: result.value, evidence, rejection: undefined };
};

export const extractConstraints = (
  request: ExtractConstraintsRequest,
): ExtractConstraintsResult => {
  const recognizers = request.recognizers ?? DEFAULT_RECOGNIZERS;
  const constraints: RepositoryConstraint[] = [];
  const evidence: EvidenceRecord[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const opaqueGuardPaths = new Set<string>();

  const consume = (extracted: ExtractedConstraint, filePath: string): void => {
    const bound = bind(extracted, filePath, request);
    if (bound.rejection !== undefined) {
      rejected.push(bound.rejection);
      return;
    }
    if (bound.constraint !== undefined && bound.evidence !== undefined) {
      constraints.push(bound.constraint);
      evidence.push(bound.evidence);
      if (bound.constraint.extraction === 'opaque') {
        opaqueGuardPaths.add(filePath);
      }
    }
  };

  for (const file of request.files) {
    for (const recognizer of recognizers) {
      if (!recognizer.appliesTo(file.path)) {
        continue;
      }
      for (const extracted of recognizer.recognize(file)) {
        consume(extracted, file.path);
      }
    }
  }
  for (const declared of request.declared ?? []) {
    consume(declared, '.impactgraph/constraints.yml');
  }

  return {
    constraints,
    evidence,
    opaqueGuardPaths: [...opaqueGuardPaths].sort(),
    rejected,
  };
};
