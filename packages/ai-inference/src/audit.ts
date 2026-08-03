import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Story 13.3 — local audit log of every external model request (Epic K). Entries carry a
// payload SUMMARY only: sizes, counts, pattern names. Never prompt text, never source code.

export interface AuditEntry {
  readonly timestamp: string;
  readonly providerId: string;
  readonly modelId?: string | undefined;
  readonly purpose: string;
  readonly privacyMode: string;
  readonly promptChars: number;
  readonly redactionCount: number;
  readonly outcome: 'sent' | 'blocked' | 'declined' | 'failed' | 'invalid-output';
  readonly detail?: string | undefined;
}

export interface AuditSink {
  record(entry: AuditEntry): void;
}

/** Append-only JSONL under `.impactgraph/` — local, human-inspectable, never transmitted. */
export const createFileAuditSink = (filePath: string): AuditSink => ({
  record: (entry): void => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Auditing must never break the analysis path; a failed write is silently dropped
      // (the call itself is still governed by the privacy guard).
    }
  },
});

export const createMemoryAuditSink = (): AuditSink & { readonly entries: AuditEntry[] } => {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record: (entry): void => {
      entries.push(entry);
    },
  };
};
