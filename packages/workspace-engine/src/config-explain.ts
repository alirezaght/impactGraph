import { readAuditEntries } from './config-audit.js';
import { loadDocuments } from './config-changes.js';
import { isConfirmed, readConfirmations } from './config-confirmations.js';
import { locateSubject, subjectImpact } from './config-subjects.js';

import type { SubjectImpact, SubjectLocation } from './config-subjects.js';
import type { ConfigFileName } from './config-validation.js';
import type { Failable } from './failure.js';
import type { ConfigAuditEntryDto, ConfigSubjectKindDto } from '@impactgraph/contracts';

// `explain_configuration` (§Z7) — deterministic, no AI. Three deterministic questions:
// what does this value do (the committed document), where did it come from (the §Z12 audit
// trail, by rollbackId), and what does it currently affect (the indexed graph).

export interface ConfigOrigin {
  readonly rollbackId: string;
  readonly timestamp: string;
  readonly actorKind: 'user' | 'agent';
  readonly agentId?: string | undefined;
  readonly reason: string;
  readonly confidence?: number | undefined;
}

export interface ConfigAuditRef {
  readonly rollbackId: string;
  readonly timestamp: string;
  readonly operationKind: string;
  readonly file: string;
}

export interface ConfigExplanation {
  readonly subject: string;
  readonly found: boolean;
  readonly subjectKind?: ConfigSubjectKindDto | undefined;
  readonly file?: ConfigFileName | undefined;
  readonly description: string;
  readonly definition?: Record<string, unknown> | undefined;
  readonly confirmed: boolean;
  readonly origin?: ConfigOrigin | undefined;
  readonly auditTrail: readonly ConfigAuditRef[];
  readonly affects: SubjectImpact;
}

/** The operation fields that name a subject — how an audit entry is tied back to a value. */
const SUBJECT_FIELDS = ['alias', 'name', 'path', 'ruleId', 'component', 'glob', 'subject'] as const;

const namesSubject = (entry: ConfigAuditEntryDto, subject: string): boolean => {
  const operation = entry.operation;
  const direct = SUBJECT_FIELDS.some((field) => operation[field] === subject);
  if (direct) {
    return true;
  }
  const rule = operation['rule'];
  return typeof rule === 'object' && rule !== null && (rule as { id?: unknown }).id === subject;
};

const INTRODUCING_PREFIXES = ['add-', 'assign-', 'confirm-'] as const;

const originOf = (entries: readonly ConfigAuditEntryDto[]): ConfigOrigin | undefined => {
  const introduced = entries.find((entry) => {
    const kind = entry.operation['kind'];
    return typeof kind === 'string' && INTRODUCING_PREFIXES.some((p) => kind.startsWith(p));
  });
  if (introduced === undefined) {
    return undefined;
  }
  return {
    rollbackId: introduced.rollbackId,
    timestamp: introduced.timestamp,
    actorKind: introduced.actor.kind,
    agentId: introduced.actor.agentId,
    reason: introduced.reason,
    confidence: introduced.confidence,
  };
};

const operationKindOf = (entry: ConfigAuditEntryDto): string => {
  const kind = entry.operation['kind'];
  return typeof kind === 'string' ? kind : 'unknown';
};

const auditRefs = (entries: readonly ConfigAuditEntryDto[]): ConfigAuditRef[] =>
  entries.map((entry) => ({
    rollbackId: entry.rollbackId,
    timestamp: entry.timestamp,
    operationKind: operationKindOf(entry),
    file: entry.file,
  }));

const notFound = (subject: string, entries: readonly ConfigAuditEntryDto[]): ConfigExplanation => ({
  subject,
  found: false,
  confirmed: false,
  description:
    'not present in any committed configuration document — it may have been removed, or the name may belong to a graph node rather than to configuration',
  auditTrail: auditRefs(entries),
  affects: {
    nodeCount: 0,
    sampleNodeIds: [],
    detail: 'nothing: the value is not configured',
  },
});

const explained = async (
  rootDir: string,
  subject: string,
  location: SubjectLocation,
  entries: readonly ConfigAuditEntryDto[],
): Promise<ConfigExplanation> => ({
  subject,
  found: true,
  subjectKind: location.subjectKind,
  file: location.file,
  description: location.description,
  definition: location.definition,
  confirmed: isConfirmed(readConfirmations(rootDir), location.subjectKind, subject),
  origin: originOf(entries),
  auditTrail: auditRefs(entries),
  affects: await subjectImpact(rootDir, location, subject),
});

export const explainConfiguration = async (
  rootDir: string,
  subject: string,
  subjectKind?: ConfigSubjectKindDto,
): Promise<Failable<ConfigExplanation>> => {
  const documents = loadDocuments(rootDir);
  if (!documents.ok) {
    return documents;
  }
  const audit = readAuditEntries(rootDir);
  if (!audit.ok) {
    return audit;
  }
  const entries = audit.value.filter((entry) => namesSubject(entry, subject));
  const location = locateSubject(documents.value, subject, subjectKind);
  if (location === undefined) {
    return { ok: true, value: notFound(subject, entries) };
  }
  return { ok: true, value: await explained(rootDir, subject, location, entries) };
};
