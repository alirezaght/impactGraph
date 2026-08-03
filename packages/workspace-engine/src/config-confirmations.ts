import { readArchitectureConfig } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type {
  AliasesConfigDto,
  ArchitectureConfigDto,
  ConfigOperationDto,
  ConfigSubjectKindDto,
  RulesConfigDto,
  WorkspaceConfigDto,
} from '@impactgraph/contracts';

// §Z5 precedence: a human-confirmed configuration value is flagged by drift detection but
// never proposed or applied against. Confirmations live in architecture.yml — the document
// that already holds human-confirmed project knowledge — and are written only through the
// governed operation path (`confirm-value`), so every confirmation is audited (§Z12).

type Confirmation = NonNullable<ArchitectureConfigDto['confirmations']>[number];

/** Just the documents a confirmation has to be checked against — no import from the applier. */
export interface ConfirmableDocuments {
  readonly workspace: WorkspaceConfigDto;
  readonly aliases: AliasesConfigDto;
  readonly architecture: ArchitectureConfigDto;
  readonly rules: RulesConfigDto;
}

export const readConfirmations = (rootDir: string): readonly Confirmation[] => {
  const architecture = readArchitectureConfig(rootDir);
  return architecture.ok ? (architecture.value?.confirmations ?? []) : [];
};

export const isConfirmed = (
  confirmations: readonly Confirmation[],
  subjectKind: ConfigSubjectKindDto,
  subject: string,
): boolean =>
  confirmations.some((entry) => entry.subjectKind === subjectKind && entry.subject === subject);

/** Which confirmable value a §Z10 drift finding is about — undefined when it is about none. */
const SUBJECT_KIND_BY_DRIFT_KIND: Readonly<Record<string, ConfigSubjectKindDto>> = {
  'dangling-alias': 'alias',
  'dangling-rule-reference': 'rule',
  'stale-context': 'context',
  'stale-component': 'component',
};

export const subjectKindForDriftKind = (driftKind: string): ConfigSubjectKindDto | undefined =>
  SUBJECT_KIND_BY_DRIFT_KIND[driftKind];

const EXISTS_BY_KIND: Readonly<
  Record<ConfigSubjectKindDto, (documents: ConfirmableDocuments, subject: string) => boolean>
> = {
  context: (documents, subject) =>
    (documents.architecture.contexts ?? []).some((context) => context.name === subject),
  component: (documents, subject) =>
    (documents.architecture.components ?? []).some((component) => component.path === subject),
  alias: (documents, subject) => (documents.aliases.aliases ?? {})[subject] !== undefined,
  exclusion: (documents, subject) =>
    (documents.aliases.exclusions ?? []).some(
      (entry) => entry.component.toLowerCase() === subject.toLowerCase(),
    ),
  rule: (documents, subject) => (documents.rules.rules ?? []).some((rule) => rule.id === subject),
  detection: (documents, subject) =>
    (documents.rules.detections ?? []).some((detection) => detection.id === subject),
  ignore: (documents, subject) => (documents.workspace.ignore ?? []).includes(subject),
};

/** §Z13: a confirmation may only target a value that actually exists, and only once. */
export const nextArchitectureWithConfirmation = (
  operation: Extract<ConfigOperationDto, { kind: 'confirm-value' }>,
  documents: ConfirmableDocuments,
  confirmedAt: string,
): Failable<ArchitectureConfigDto> => {
  if (!EXISTS_BY_KIND[operation.subjectKind](documents, operation.subject)) {
    return failWith(
      'configurationError',
      `no ${operation.subjectKind} named '${operation.subject}' in the committed configuration`,
    );
  }
  const current = documents.architecture.confirmations ?? [];
  if (isConfirmed(current, operation.subjectKind, operation.subject)) {
    return failWith(
      'configurationError',
      `${operation.subjectKind} '${operation.subject}' is already human-confirmed`,
    );
  }
  return {
    ok: true,
    value: {
      ...documents.architecture,
      confirmations: [
        ...current,
        {
          subjectKind: operation.subjectKind,
          subject: operation.subject,
          reason: operation.reason,
          confirmedAt,
        },
      ],
    },
  };
};
