import { readWorkspaceConfig } from '@impactgraph/persistence';

import { appendAuditEntry, readAuditEntries } from './config-audit.js';
import { previewOperation } from './config-changes.js';
import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ConfigAuditEntryDto, ConfigOperationDto } from '@impactgraph/contracts';

export { previewOperation } from './config-changes.js';

// §Z6/§Z7/§Z11 — the structured-operation applier. One path for every configuration change:
// classify (safe/material) → mode gate → compute new document → validate → atomic write →
// audit. Human-confirmed values are only ever changed by an explicitly approved operation.

export interface ConfigActor {
  readonly kind: 'user' | 'agent';
  readonly agentId?: string | undefined;
  readonly modelId?: string | undefined;
}

export interface ApplyOperationRequest {
  readonly rootDir: string;
  readonly operation: ConfigOperationDto;
  readonly actor: ConfigActor;
  /** A human explicitly approved this change (material changes require it, §Z11). */
  readonly approvedByUser?: boolean | undefined;
}

export type ChangeClassification = 'safe' | 'material';

/** §Z11 hard floor: these can NEVER be declared safe, whatever the configuration says. */
const NEVER_SAFE = new Set(['set-privacy-mode', 'set-automation-mode']);

/**
 * §Z11 defaults: adding an ignore for generated output is safe; everything that merges,
 * removes, re-owns, or changes privacy/rules/aliases is material. The boundary is
 * configurable via `automation.safeOperations`, except for the hard floor above.
 */
export const classifyOperation = (
  operation: ConfigOperationDto,
  safeOverrides: readonly string[] = [],
): ChangeClassification => {
  if (NEVER_SAFE.has(operation.kind)) {
    return 'material';
  }
  if (operation.kind === 'add-ignore' || safeOverrides.includes(operation.kind)) {
    return 'safe';
  }
  return 'material';
};

const modeGate = (
  request: ApplyOperationRequest,
  classification: ChangeClassification,
): Failable<'auto' | 'approved'> => {
  if (request.approvedByUser === true) {
    return { ok: true, value: 'approved' };
  }
  if (request.actor.kind === 'user') {
    return { ok: true, value: 'approved' }; // the user IS the approval
  }
  const config = readWorkspaceConfig(request.rootDir);
  const mode = (config.ok ? config.value?.automation?.mode : undefined) ?? 'review';
  if (mode === 'manual') {
    return failWith('configurationError', 'manual mode: agents may not change configuration (§Z6)');
  }
  if (mode === 'autonomous' && classification === 'safe') {
    return { ok: true, value: 'auto' };
  }
  return failWith(
    'configurationError',
    `this ${classification} change requires explicit user approval (mode: ${mode}, §Z11) — re-submit with approvedByUser: true after confirming with the user`,
  );
};

interface AuditInput {
  readonly request: ApplyOperationRequest;
  readonly classification: ChangeClassification;
  readonly approval: 'auto' | 'approved';
  readonly file: string;
  readonly previousDocument: Record<string, unknown>;
  readonly newDocument: Record<string, unknown>;
}

const auditEntryFor = ({
  request,
  classification,
  approval,
  file,
  previousDocument,
  newDocument,
}: AuditInput): ConfigAuditEntryDto => ({
  schemaVersion: 1,
  rollbackId: `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  timestamp: new Date().toISOString(),
  actor: {
    kind: request.actor.kind,
    ...(request.actor.agentId === undefined ? {} : { agentId: request.actor.agentId }),
    ...(request.actor.modelId === undefined ? {} : { modelId: request.actor.modelId }),
  },
  operation: { ...request.operation },
  classification,
  approval,
  file,
  previousDocument,
  newDocument,
  validationResult: 'valid',
  reason: request.operation.reason,
  ...(request.operation.confidence === undefined
    ? {}
    : { confidence: request.operation.confidence }),
});

export const applyConfigOperation = (
  request: ApplyOperationRequest,
): Failable<ConfigAuditEntryDto> => {
  const config = readWorkspaceConfig(request.rootDir);
  const safeOverrides = (config.ok ? config.value?.automation?.safeOperations : undefined) ?? [];
  const classification = classifyOperation(request.operation, safeOverrides);
  const approval = modeGate(request, classification);
  if (!approval.ok) {
    return approval;
  }
  // §Z5: a change a human approved is human-confirmed (level 1); one an agent applied on its own
  // under autonomous mode is agent-approved (level 2). The level is persisted with the record.
  const source = approval.value === 'approved' ? 'human-confirmed' : 'agent-approved';
  const change = previewOperation(request.rootDir, request.operation, source);
  if (!change.ok) {
    return change;
  }
  const written = change.value.write();
  if (!written.ok) {
    return written;
  }
  const entry = auditEntryFor({
    request,
    classification,
    approval: approval.value,
    file: change.value.file,
    previousDocument: change.value.previousDocument,
    newDocument: change.value.newDocument,
  });
  const audited = appendAuditEntry(request.rootDir, entry);
  if (!audited.ok) {
    return audited;
  }
  return { ok: true, value: entry };
};

export { readAuditEntries as configHistory };
