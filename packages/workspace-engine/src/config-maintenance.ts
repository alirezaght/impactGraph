import { readAuditEntries } from './config-audit.js';
import { isConfirmed, readConfirmations, subjectKindForDriftKind } from './config-confirmations.js';
import { detectConfigDrift } from './config-drift.js';
import { generateConfiguration } from './config-generation.js';
import { applyConfigOperation } from './config-operations.js';

import type { DriftItem } from './config-drift.js';
import type { ConfigActor } from './config-operations.js';
import type { Failable } from './failure.js';
import type { ConfigOperationDto, ConfigSubjectKindDto } from '@impactgraph/contracts';

// §Z10 maintenance actions. `refresh` re-runs detection-first generation through the SAME
// governed path and adds a deterministic change report; `removeStale` deletes only what drift
// flagged as dangling, one audited operation at a time, and never touches a §Z5 confirmation.

export interface RefreshOutcome {
  readonly applied: readonly DriftItem[];
  readonly needsReview: readonly DriftItem[];
  readonly changedFiles: readonly string[];
  readonly previousChangeAt?: string | undefined;
  readonly changeCountBefore: number;
}

/**
 * Identical generation semantics to `generateConfiguration` — the drift engine's suggestions
 * applied through the audited operation path — plus the delta this run produced. There is no
 * stored "previous detection result" to diff against, so the report is derived from the §Z12
 * audit trail: what existed before, and which files this run wrote.
 */
export const refreshConfiguration = async (
  rootDir: string,
  actor: ConfigActor,
): Promise<Failable<RefreshOutcome>> => {
  const before = readAuditEntries(rootDir);
  const previous = before.ok ? before.value : [];
  const generated = await generateConfiguration(rootDir, actor);
  if (!generated.ok) {
    return generated;
  }
  const after = readAuditEntries(rootDir);
  const appended = after.ok ? after.value.slice(previous.length) : [];
  return {
    ok: true,
    value: {
      applied: generated.value.applied,
      needsReview: generated.value.needsReview,
      changedFiles: [...new Set(appended.map((entry) => entry.file))].sort(),
      previousChangeAt: previous[previous.length - 1]?.timestamp,
      changeCountBefore: previous.length,
    },
  };
};

export interface ConfirmValueRequest {
  readonly subjectKind: ConfigSubjectKindDto;
  readonly subject: string;
  readonly reason: string;
}

export interface ConfirmValueOutcome {
  readonly rollbackId: string;
  readonly file: 'architecture.yml';
  readonly subject: string;
  readonly subjectKind: ConfigSubjectKindDto;
  readonly confirmationCount: number;
}

/**
 * §Z5: record that a human confirmed a configuration value. The tool contract already carried
 * the confirmation assertion (§35), so the operation is submitted as approved; it still goes
 * through classification, the §Z13 gate, the atomic write, and the §Z12 audit trail.
 */
export const confirmConfigurationValue = (
  rootDir: string,
  actor: ConfigActor,
  request: ConfirmValueRequest,
): Failable<ConfirmValueOutcome> => {
  const applied = applyConfigOperation({
    rootDir,
    operation: {
      kind: 'confirm-value',
      subjectKind: request.subjectKind,
      subject: request.subject,
      reason: request.reason,
    },
    actor,
    approvedByUser: true,
  });
  if (!applied.ok) {
    return applied;
  }
  return {
    ok: true,
    value: {
      rollbackId: applied.value.rollbackId,
      file: 'architecture.yml',
      subject: request.subject,
      subjectKind: request.subjectKind,
      confirmationCount: readConfirmations(rootDir).length,
    },
  };
};

export interface StaleRemoval {
  readonly kind: string;
  readonly subject: string;
  readonly file: string;
  readonly rollbackId: string;
}

export interface StaleSkip {
  readonly kind: string;
  readonly subject: string;
  readonly reason: string;
}

export interface RemoveStaleOutcome {
  readonly removed: readonly StaleRemoval[];
  readonly skipped: readonly StaleSkip[];
}

/** Findings that describe an entry pointing at something that no longer exists (§Z10). */
const STALE_KINDS = new Set(['dangling-alias', 'dangling-rule-reference']);

const removalFor = (item: DriftItem): ConfigOperationDto | undefined => {
  if (item.suggestedOperation !== undefined) {
    return item.suggestedOperation;
  }
  if (item.kind === 'dangling-rule-reference') {
    return { kind: 'remove-rule', ruleId: item.subject, reason: item.detail.slice(0, 500) };
  }
  return undefined;
};

interface RemovalState {
  readonly removed: StaleRemoval[];
  readonly skipped: StaleSkip[];
}

const removeOne = (
  rootDir: string,
  actor: ConfigActor,
  item: DriftItem,
  state: RemovalState,
): void => {
  const operation = removalFor(item);
  if (operation === undefined) {
    state.skipped.push({
      kind: item.kind,
      subject: item.subject,
      reason: 'no structured removal operation exists for this finding',
    });
    return;
  }
  // The tool contract already required explicit human confirmation (§35).
  const applied = applyConfigOperation({ rootDir, operation, actor, approvedByUser: true });
  if (!applied.ok) {
    state.skipped.push({ kind: item.kind, subject: item.subject, reason: applied.error.message });
    return;
  }
  state.removed.push({
    kind: item.kind,
    subject: item.subject,
    file: applied.value.file,
    rollbackId: applied.value.rollbackId,
  });
};

export const removeStaleConfiguration = async (
  rootDir: string,
  actor: ConfigActor,
  subjects?: readonly string[],
): Promise<Failable<RemoveStaleOutcome>> => {
  const drift = await detectConfigDrift(rootDir);
  if (!drift.ok) {
    return drift;
  }
  const confirmations = readConfirmations(rootDir);
  const state: RemovalState = { removed: [], skipped: [] };
  const candidates = [...drift.value.needsReview, ...drift.value.suggestions].filter(
    (item) =>
      STALE_KINDS.has(item.kind) && (subjects === undefined || subjects.includes(item.subject)),
  );
  for (const item of candidates) {
    const subjectKind = subjectKindForDriftKind(item.kind);
    if (subjectKind !== undefined && isConfirmed(confirmations, subjectKind, item.subject)) {
      state.skipped.push({
        kind: item.kind,
        subject: item.subject,
        reason: 'human-confirmed (§Z5): kept, never removed automatically',
      });
      continue;
    }
    removeOne(rootDir, actor, item, state);
  }
  return { ok: true, value: { removed: state.removed, skipped: state.skipped } };
};
