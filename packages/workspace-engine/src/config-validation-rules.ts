import { loadDocuments } from './config-changes.js';

import type { Documents } from './config-changes.js';

// The cross-file half of the §Z13 gate: checks that no single document's schema can express.
// Read-only and deterministic — every finding is a message a human can act on, never a repair.

const duplicates = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated].sort();
};

const duplicateMessages = (documents: Documents): string[] => {
  const messages: string[] = [];
  const report = (label: string, values: readonly string[]): void => {
    for (const value of duplicates(values)) {
      messages.push(`duplicate ${label}: '${value}'`);
    }
  };
  report(
    'context name',
    (documents.architecture.contexts ?? []).map((context) => context.name),
  );
  report(
    'rule id',
    (documents.rules.rules ?? []).map((rule) => rule.id),
  );
  report(
    'detection rule id',
    (documents.rules.detections ?? []).map((detection) => detection.id),
  );
  report('ignore glob', documents.workspace.ignore ?? []);
  return messages;
};

const referenceMessages = (documents: Documents): string[] => {
  const contexts = new Set((documents.architecture.contexts ?? []).map((entry) => entry.name));
  const messages: string[] = [];
  for (const component of documents.architecture.components ?? []) {
    if (component.context !== undefined && !contexts.has(component.context)) {
      messages.push(
        `component '${component.path}' is assigned to undefined context '${component.context}'`,
      );
    }
  }
  for (const context of documents.architecture.contexts ?? []) {
    if (context.paths.length === 0) {
      messages.push(`context '${context.name}' owns no paths`);
    }
  }
  return messages;
};

const CONFIRMATION_SUBJECTS: Readonly<Record<string, (documents: Documents) => readonly string[]>> =
  {
    context: (documents) => (documents.architecture.contexts ?? []).map((entry) => entry.name),
    component: (documents) => (documents.architecture.components ?? []).map((entry) => entry.path),
    alias: (documents) => Object.keys(documents.aliases.aliases ?? {}),
    exclusion: (documents) => (documents.aliases.exclusions ?? []).map((entry) => entry.component),
    rule: (documents) => (documents.rules.rules ?? []).map((entry) => entry.id),
    detection: (documents) => (documents.rules.detections ?? []).map((entry) => entry.id),
    ignore: (documents) => documents.workspace.ignore ?? [],
  };

/** §Z5: a confirmation whose subject vanished is drift a human must resolve, not a repair. */
const confirmationMessages = (documents: Documents): string[] =>
  (documents.architecture.confirmations ?? [])
    .filter(
      (confirmation) =>
        !(CONFIRMATION_SUBJECTS[confirmation.subjectKind]?.(documents) ?? []).includes(
          confirmation.subject,
        ),
    )
    .map(
      (confirmation) =>
        `confirmation targets a missing ${confirmation.subjectKind}: '${confirmation.subject}'`,
    );

/** §Z13 privacy conflict: local-only forbids any configured outbound provider (§9). */
const privacyMessages = (documents: Documents): string[] => {
  const strategy = documents.workspace.provider?.strategy;
  if (
    documents.workspace.privacyMode === 'local-only' &&
    strategy !== undefined &&
    strategy !== 'none' &&
    strategy !== 'external-agent'
  ) {
    return [`privacy conflict: privacyMode 'local-only' with provider strategy '${strategy}'`];
  }
  return [];
};

export const crossFileMessages = (rootDir: string): readonly string[] => {
  const documents = loadDocuments(rootDir);
  if (!documents.ok) {
    return [documents.error.message];
  }
  return [
    ...duplicateMessages(documents.value),
    ...referenceMessages(documents.value),
    ...confirmationMessages(documents.value),
    ...privacyMessages(documents.value),
  ];
};
