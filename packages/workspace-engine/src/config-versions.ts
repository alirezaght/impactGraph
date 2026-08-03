import { appendAuditEntry, readAuditEntries } from './config-audit.js';
import { readDocument, restoreDocument } from './config-rollback.js';
import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ConfigAuditEntryDto } from '@impactgraph/contracts';

// §Z14 completion: `config diff` shows exactly what an audited change did; `config restore`
// brings back the state AFTER a chosen entry — both over the append-only trail, which is
// never rewritten.

export interface DiffLine {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

const flatten = (value: unknown, prefix: string, into: Map<string, unknown>): void => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, into);
    }
    return;
  }
  into.set(prefix, value);
};

/** Flat structural diff of two documents — small committed YAML, so this stays readable. */
export const documentDiff = (
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): DiffLine[] => {
  const before = new Map<string, unknown>();
  const after = new Map<string, unknown>();
  flatten(previous ?? {}, '', before);
  flatten(next, '', after);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths
    .filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .map((path) => ({ path, before: before.get(path), after: after.get(path) }));
};

export interface ConfigDiffResult {
  readonly entry: ConfigAuditEntryDto;
  readonly lines: readonly DiffLine[];
}

/** Diff of one audited change (default: the most recent). */
export const configDiff = (rootDir: string, rollbackId?: string): Failable<ConfigDiffResult> => {
  const history = readAuditEntries(rootDir);
  if (!history.ok) {
    return history;
  }
  const entry =
    rollbackId === undefined
      ? history.value[history.value.length - 1]
      : history.value.find((candidate) => candidate.rollbackId === rollbackId);
  if (entry === undefined) {
    return failWith('configurationError', 'no matching configuration change');
  }
  return {
    ok: true,
    value: { entry, lines: documentDiff(entry.previousDocument, entry.newDocument) },
  };
};

/** §Z14 `config restore <version>`: re-apply the state AFTER the chosen entry, by append. */
export const restoreConfigVersion = (
  rootDir: string,
  rollbackId: string,
  actor: { kind: 'user' | 'agent'; agentId?: string | undefined },
): Failable<ConfigAuditEntryDto> => {
  const history = readAuditEntries(rootDir);
  if (!history.ok) {
    return history;
  }
  const target = history.value.find((entry) => entry.rollbackId === rollbackId);
  if (target === undefined) {
    return failWith('configurationError', `no configuration change with id ${rollbackId}`);
  }
  const current = readDocument(rootDir, target.file);
  const restored = restoreDocument(rootDir, target.file, target.newDocument);
  if (!restored.ok) {
    return restored;
  }
  const entry: ConfigAuditEntryDto = {
    schemaVersion: 1,
    rollbackId: `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    actor: {
      kind: actor.kind,
      ...(actor.agentId === undefined ? {} : { agentId: actor.agentId }),
    },
    operation: { kind: 'restore', target: target.rollbackId },
    classification: 'material',
    approval: 'approved',
    file: target.file,
    previousDocument: current,
    newDocument: target.newDocument,
    validationResult: 'valid',
    reason: `restore to the state after ${target.rollbackId}`,
    rollbackOf: target.rollbackId,
  };
  const audited = appendAuditEntry(rootDir, entry);
  if (!audited.ok) {
    return audited;
  }
  return { ok: true, value: entry };
};
