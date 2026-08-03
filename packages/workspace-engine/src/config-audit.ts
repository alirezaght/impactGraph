import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configAuditEntrySchema } from '@impactgraph/contracts';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ConfigAuditEntryDto } from '@impactgraph/contracts';

// §Z12 — the append-only configuration audit trail. JSONL under artifacts: every applied
// change and every rollback is one immutable line; rollback appends, never rewrites (§Z14).

export const configAuditPath = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts', 'config-audit.jsonl');

export const appendAuditEntry = (rootDir: string, entry: ConfigAuditEntryDto): Failable<void> => {
  const validated = configAuditEntrySchema.safeParse(entry);
  if (!validated.success) {
    return failWith('internalError', 'audit entry failed contract validation');
  }
  try {
    const path = configAuditPath(rootDir);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(validated.data)}\n`, 'utf8');
    return { ok: true, value: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot write config audit: ${message}`);
  }
};

export const readAuditEntries = (rootDir: string): Failable<ConfigAuditEntryDto[]> => {
  const path = configAuditPath(rootDir);
  if (!existsSync(path)) {
    return { ok: true, value: [] };
  }
  try {
    const entries: ConfigAuditEntryDto[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      const parsed = configAuditEntrySchema.safeParse(JSON.parse(line) as unknown);
      if (!parsed.success) {
        return failWith('configurationError', 'corrupt config audit entry');
      }
      entries.push(parsed.data);
    }
    return { ok: true, value: entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot read config audit: ${message}`);
  }
};
