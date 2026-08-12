import type { ExtractedConstraint } from '../types.js';
import type {
  ConstraintKind,
  ConstraintRelation,
  ConstraintSeverity,
} from '@impactgraph/domain';

/**
 * Human-declared constraints from `.impactgraph/constraints.yml`.
 *
 * Two jobs. First, it is the escape hatch for every guard no recognizer understands — a team can
 * state the rule in one place instead of waiting for an extractor. Second, it is the only route by
 * which a rule that lives in someone's head, or in an ADR, or in another repository's CI, can be
 * made to block: declared constraints are human-confirmed, so they carry full authority.
 *
 * Parsing is not done here. The composition root validates the YAML against the contracts schema
 * and hands over already-typed entries, keeping this layer free of both I/O and a YAML dependency.
 */

/** One entry as the config schema delivers it. */
export interface DeclaredConstraintEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: ConstraintKind;
  readonly severity: ConstraintSeverity;
  readonly relation: ConstraintRelation;
  readonly statement: string;
  readonly appliesTo: readonly string[];
  readonly forbids?: string;
  readonly targetPaths?: readonly string[];
  readonly requires?: readonly string[];
  readonly exempt?: readonly string[];
  readonly roles?: readonly string[];
}

export const CONSTRAINTS_MANIFEST_PATH = '.impactgraph/constraints.yml';

export const fromDeclaredEntries = (
  entries: readonly DeclaredConstraintEntry[],
): readonly ExtractedConstraint[] =>
  entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    severity: entry.severity,
    // `declared` carries full authority: a human wrote it down, so a reviewer can argue with it.
    extraction: 'declared' as const,
    scope: {
      pathGlobs: [...entry.appliesTo],
      ...(entry.roles === undefined ? {} : { roles: [...entry.roles] }),
    },
    rule: {
      relation: entry.relation,
      statement: entry.statement,
      ...(entry.forbids === undefined ? {} : { subjectPattern: entry.forbids }),
      ...(entry.targetPaths === undefined
        ? {}
        : { targetScope: { pathGlobs: [...entry.targetPaths] } }),
      ...(entry.requires === undefined ? {} : { requiredNames: [...entry.requires] }),
    },
    exemptions: (entry.exempt ?? []).map((subject) => ({
      id: `${entry.id}:${subject}`,
      subject,
      reason: 'declared exemption',
    })),
    recognizer: 'declared-manifest',
  }));
