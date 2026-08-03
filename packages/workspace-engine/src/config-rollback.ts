import {
  aliasesConfigSchema,
  architectureConfigSchema,
  rulesConfigSchema,
  workspaceConfigSchema,
} from '@impactgraph/contracts';
import {
  readAliasesConfig,
  readArchitectureConfig,
  readRulesConfig,
  readWorkspaceConfig,
  writeAliasesConfig,
  writeArchitectureConfig,
  writeRulesConfig,
  writeWorkspaceConfig,
} from '@impactgraph/persistence';

import { appendAuditEntry, readAuditEntries } from './config-audit.js';
import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ConfigAuditEntryDto } from '@impactgraph/contracts';

// §Z14 — rollback restores the exact prior document of an audited change by APPENDING a new
// audit entry; the trail is never rewritten. Restoring still passes the §Z13 validation gate.

export const restoreDocument = (
  rootDir: string,
  file: string,
  document: Record<string, unknown>,
): Failable<void> => {
  const write = (result: { ok: boolean; error?: { message: string } }): Failable<void> =>
    result.ok
      ? { ok: true, value: undefined }
      : failWith('configurationError', result.error?.message ?? 'write failed');
  if (file === 'config.yml') {
    const parsed = workspaceConfigSchema.safeParse(document);
    return parsed.success
      ? write(writeWorkspaceConfig(rootDir, parsed.data))
      : failWith('configurationError', 'previous config.yml no longer validates');
  }
  if (file === 'aliases.yml') {
    const parsed = aliasesConfigSchema.safeParse(document);
    return parsed.success
      ? write(writeAliasesConfig(rootDir, parsed.data))
      : failWith('configurationError', 'previous aliases.yml no longer validates');
  }
  if (file === 'architecture.yml') {
    const parsed = architectureConfigSchema.safeParse(document);
    return parsed.success
      ? write(writeArchitectureConfig(rootDir, parsed.data))
      : failWith('configurationError', 'previous architecture.yml no longer validates');
  }
  if (file === 'rules.yml') {
    const parsed = rulesConfigSchema.safeParse(document);
    return parsed.success
      ? write(writeRulesConfig(rootDir, parsed.data))
      : failWith('configurationError', 'previous rules.yml no longer validates');
  }
  return failWith('configurationError', `unknown configuration file: ${file}`);
};

/** Current on-disk document of one configuration file (for exact restore accounting). */
export const readDocument = (rootDir: string, file: string): Record<string, unknown> | null => {
  const read =
    file === 'config.yml'
      ? readWorkspaceConfig(rootDir)
      : file === 'aliases.yml'
        ? readAliasesConfig(rootDir)
        : file === 'architecture.yml'
          ? readArchitectureConfig(rootDir)
          : file === 'rules.yml'
            ? readRulesConfig(rootDir)
            : undefined;
  if (read === undefined || !read.ok || read.value === undefined) {
    return null;
  }
  return { ...read.value };
};

export interface RollbackRequest {
  readonly rootDir: string;
  /** Entry to undo; defaults to the most recent non-rollback change. */
  readonly rollbackId?: string | undefined;
  readonly actor: { kind: 'user' | 'agent'; agentId?: string | undefined };
}

export const rollbackConfigChange = (request: RollbackRequest): Failable<ConfigAuditEntryDto> => {
  const history = readAuditEntries(request.rootDir);
  if (!history.ok) {
    return history;
  }
  const target =
    request.rollbackId === undefined
      ? [...history.value].reverse().find((entry) => entry.rollbackOf === undefined)
      : history.value.find((entry) => entry.rollbackId === request.rollbackId);
  if (target === undefined) {
    return failWith('configurationError', 'no configuration change to roll back');
  }
  if (target.previousDocument === null) {
    return failWith('configurationError', 'the targeted change has no prior state to restore');
  }
  const restored = restoreDocument(request.rootDir, target.file, target.previousDocument);
  if (!restored.ok) {
    return restored;
  }
  const entry: ConfigAuditEntryDto = {
    schemaVersion: 1,
    rollbackId: `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    actor: {
      kind: request.actor.kind,
      ...(request.actor.agentId === undefined ? {} : { agentId: request.actor.agentId }),
    },
    operation: { kind: 'rollback', target: target.rollbackId },
    classification: 'material',
    approval: 'approved',
    file: target.file,
    previousDocument: target.newDocument,
    newDocument: target.previousDocument,
    validationResult: 'valid',
    reason: `rollback of ${target.rollbackId}`,
    rollbackOf: target.rollbackId,
  };
  const audited = appendAuditEntry(request.rootDir, entry);
  if (!audited.ok) {
    return audited;
  }
  return { ok: true, value: entry };
};
