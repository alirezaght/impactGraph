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

import { nextArchitectureWithConfirmation } from './config-confirmations.js';
import { isComponentCorrection, nextArchitectureWithCorrection } from './config-corrections.js';
import { repositoryGlobMatcher } from './config-path-matching.js';
import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type {
  AliasesConfigDto,
  ArchitectureConfigDto,
  ComponentCorrectionDto,
  ConfigOperationDto,
  ConfigSourceDto,
  RulesConfigDto,
  WorkspaceConfigDto,
} from '@impactgraph/contracts';

// The per-file document builders behind the §Z7 operation applier — split from
// config-operations.ts by responsibility (LOC policy). Every builder validates its
// preconditions (duplicates, conflicts) and returns an atomic write closure.

const persistError = (message: string): Failable<never> => failWith('configurationError', message);

export type Documents = {
  readonly workspace: WorkspaceConfigDto;
  readonly aliases: AliasesConfigDto;
  readonly architecture: ArchitectureConfigDto;
  readonly rules: RulesConfigDto;
};

export interface ComputedChange {
  readonly file: string;
  readonly previousDocument: Record<string, unknown>;
  readonly newDocument: Record<string, unknown>;
  readonly write: () => Failable<void>;
}

export const loadDocuments = (rootDir: string): Failable<Documents> => {
  const workspace = readWorkspaceConfig(rootDir);
  if (!workspace.ok) {
    return persistError(`config.yml: ${workspace.error.message}`);
  }
  const aliases = readAliasesConfig(rootDir);
  if (!aliases.ok) {
    return persistError(`aliases.yml: ${aliases.error.message}`);
  }
  const architecture = readArchitectureConfig(rootDir);
  if (!architecture.ok) {
    return persistError(`architecture.yml: ${architecture.error.message}`);
  }
  const rules = readRulesConfig(rootDir);
  if (!rules.ok) {
    return persistError(`rules.yml: ${rules.error.message}`);
  }
  return {
    ok: true,
    value: {
      workspace: workspace.value ?? { schemaVersion: 1 },
      aliases: aliases.value ?? { schemaVersion: 1 },
      architecture: architecture.value ?? { schemaVersion: 1 },
      rules: rules.value ?? { schemaVersion: 1 },
    },
  };
};

/**
 * `source` is the §Z5 level the persisted record will claim. The applier passes the level derived
 * from the approval it just computed; a bare preview writes nothing, so it assumes the level a
 * human-approved apply would produce.
 */
export const previewOperation = (
  rootDir: string,
  operation: ConfigOperationDto,
  source: ConfigSourceDto = 'human-confirmed',
): Failable<ComputedChange> => {
  const documents = loadDocuments(rootDir);
  if (!documents.ok) {
    return documents;
  }
  return computeChange(rootDir, operation, documents.value, source);
};

const modeChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'set-privacy-mode' | 'set-automation-mode' }>,
  workspace: WorkspaceConfigDto,
): Failable<ComputedChange> =>
  workspaceChange(
    rootDir,
    workspace,
    operation.kind === 'set-privacy-mode'
      ? { ...workspace, privacyMode: operation.mode }
      : { ...workspace, automation: { mode: operation.mode } },
  );

const knowledgeChange = (
  rootDir: string,
  operation: Exclude<
    ConfigOperationDto,
    | ComponentCorrectionDto
    | { kind: 'add-ignore' | 'remove-ignore' | 'set-privacy-mode' | 'set-automation-mode' }
  >,
  documents: Documents,
  source: ConfigSourceDto,
): Failable<ComputedChange> => {
  switch (operation.kind) {
    case 'add-alias':
    case 'remove-alias':
      return aliasChange(rootDir, operation, documents.aliases);
    case 'add-exclusion':
    case 'remove-exclusion':
      return exclusionChange(rootDir, operation, documents.aliases);
    case 'add-context':
    case 'assign-component':
      return architectureChange(rootDir, operation, documents.architecture, source);
    case 'confirm-value':
      return confirmationChange(rootDir, operation, documents);
    case 'add-rule':
    case 'remove-rule':
      return rulesChange(rootDir, operation, documents.rules);
    default:
      return failWith('configurationError', 'unknown operation kind');
  }
};

/** §16 corrections all land in architecture.yml, tagged with the §Z5 level that produced them. */
const correctionChange = (
  rootDir: string,
  operation: ComponentCorrectionDto,
  architecture: ArchitectureConfigDto,
  source: ConfigSourceDto,
): Failable<ComputedChange> => {
  const computed = nextArchitectureWithCorrection(operation, architecture, {
    now: new Date().toISOString(),
    source,
    // Lazy: only the builders that need a path check pay for the repository walk.
    matchesRepositoryPath: repositoryGlobMatcher(rootDir),
  });
  return computed.ok ? architectureWrite(rootDir, architecture, computed.value) : computed;
};

export const computeChange = (
  rootDir: string,
  operation: ConfigOperationDto,
  documents: Documents,
  source: ConfigSourceDto = 'human-confirmed',
): Failable<ComputedChange> => {
  if (operation.kind === 'add-ignore' || operation.kind === 'remove-ignore') {
    return ignoreChange(rootDir, operation, documents.workspace);
  }
  if (operation.kind === 'set-privacy-mode' || operation.kind === 'set-automation-mode') {
    return modeChange(rootDir, operation, documents.workspace);
  }
  if (isComponentCorrection(operation)) {
    return correctionChange(rootDir, operation, documents.architecture, source);
  }
  return knowledgeChange(rootDir, operation, documents, source);
};

const workspaceChange = (
  rootDir: string,
  previous: WorkspaceConfigDto,
  next: WorkspaceConfigDto,
): Failable<ComputedChange> => ({
  ok: true,
  value: {
    file: 'config.yml',
    previousDocument: { ...previous },
    newDocument: { ...next },
    write: () => {
      const written = writeWorkspaceConfig(rootDir, next);
      return written.ok ? { ok: true, value: undefined } : persistError(written.error.message);
    },
  },
});

const ignoreChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'add-ignore' | 'remove-ignore' }>,
  workspace: WorkspaceConfigDto,
): Failable<ComputedChange> => {
  const current = workspace.ignore ?? [];
  if (operation.kind === 'add-ignore' && current.includes(operation.glob)) {
    return failWith('configurationError', `ignore glob already present: ${operation.glob}`);
  }
  if (operation.kind === 'remove-ignore' && !current.includes(operation.glob)) {
    return failWith('configurationError', `ignore glob not present: ${operation.glob}`);
  }
  const ignore =
    operation.kind === 'add-ignore'
      ? [...current, operation.glob]
      : current.filter((glob) => glob !== operation.glob);
  return workspaceChange(rootDir, workspace, { ...workspace, ignore });
};

const aliasChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'add-alias' | 'remove-alias' }>,
  aliases: AliasesConfigDto,
): Failable<ComputedChange> => {
  const current = aliases.aliases ?? {};
  if (operation.kind === 'add-alias' && current[operation.alias] !== undefined) {
    return failWith('configurationError', `alias already defined: ${operation.alias}`);
  }
  if (operation.kind === 'remove-alias' && current[operation.alias] === undefined) {
    return failWith('configurationError', `alias not defined: ${operation.alias}`);
  }
  const nextAliases = { ...current };
  if (operation.kind === 'add-alias') {
    nextAliases[operation.alias] = operation.canonical;
  } else {
    delete nextAliases[operation.alias];
  }
  const next: AliasesConfigDto = { ...aliases, aliases: nextAliases };
  return {
    ok: true,
    value: {
      file: 'aliases.yml',
      previousDocument: { ...aliases },
      newDocument: { ...next },
      write: () => {
        const written = writeAliasesConfig(rootDir, next);
        return written.ok ? { ok: true, value: undefined } : persistError(written.error.message);
      },
    },
  };
};

const addContext = (
  operation: Extract<ConfigOperationDto, { kind: 'add-context' }>,
  architecture: ArchitectureConfigDto,
  source: ConfigSourceDto,
): Failable<ArchitectureConfigDto> => {
  if ((architecture.contexts ?? []).some((context) => context.name === operation.name)) {
    return failWith('configurationError', `context already defined: ${operation.name}`);
  }
  return {
    ok: true,
    value: {
      ...architecture,
      contexts: [
        ...(architecture.contexts ?? []),
        {
          name: operation.name,
          paths: [...operation.paths],
          source,
          ...(operation.description === undefined ? {} : { description: operation.description }),
        },
      ],
    },
  };
};

const assignComponent = (
  operation: Extract<ConfigOperationDto, { kind: 'assign-component' }>,
  architecture: ArchitectureConfigDto,
  source: ConfigSourceDto,
): Failable<ArchitectureConfigDto> => {
  if (operation.role === undefined && operation.context === undefined) {
    return failWith('configurationError', 'assign-component needs a role or a context');
  }
  return {
    ok: true,
    value: {
      ...architecture,
      components: [
        ...(architecture.components ?? []),
        {
          path: operation.path,
          source,
          ...(operation.role === undefined ? {} : { role: operation.role }),
          ...(operation.context === undefined ? {} : { context: operation.context }),
        },
      ],
    },
  };
};

const rulesChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'add-rule' | 'remove-rule' }>,
  rules: RulesConfigDto,
): Failable<ComputedChange> => {
  const current = rules.rules ?? [];
  if (operation.kind === 'add-rule' && current.some((rule) => rule.id === operation.rule.id)) {
    return failWith('configurationError', `rule already defined: ${operation.rule.id}`);
  }
  if (operation.kind === 'remove-rule' && !current.some((rule) => rule.id === operation.ruleId)) {
    return failWith('configurationError', `rule not defined: ${operation.ruleId}`);
  }
  const next: RulesConfigDto = {
    ...rules,
    rules:
      operation.kind === 'add-rule'
        ? [...current, operation.rule]
        : current.filter((rule) => rule.id !== operation.ruleId),
  };
  return {
    ok: true,
    value: {
      file: 'rules.yml',
      previousDocument: { ...rules },
      newDocument: { ...next },
      write: () => {
        const written = writeRulesConfig(rootDir, next);
        return written.ok ? { ok: true, value: undefined } : persistError(written.error.message);
      },
    },
  };
};

const exclusionChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'add-exclusion' | 'remove-exclusion' }>,
  aliases: AliasesConfigDto,
): Failable<ComputedChange> => {
  const current = aliases.exclusions ?? [];
  const exists = current.some(
    (entry) => entry.component.toLowerCase() === operation.component.toLowerCase(),
  );
  if (operation.kind === 'add-exclusion' && exists) {
    return persistError(`exclusion already defined: ${operation.component}`);
  }
  if (operation.kind === 'remove-exclusion' && !exists) {
    return persistError(`exclusion not defined: ${operation.component}`);
  }
  const exclusions =
    operation.kind === 'add-exclusion'
      ? [...current, { component: operation.component, reason: operation.reason }]
      : current.filter(
          (entry) => entry.component.toLowerCase() !== operation.component.toLowerCase(),
        );
  const next: AliasesConfigDto = { ...aliases, exclusions };
  return {
    ok: true,
    value: {
      file: 'aliases.yml',
      previousDocument: { ...aliases },
      newDocument: { ...next },
      write: () => {
        const written = writeAliasesConfig(rootDir, next);
        return written.ok ? { ok: true, value: undefined } : persistError(written.error.message);
      },
    },
  };
};

const nextArchitecture = (
  operation: Extract<ConfigOperationDto, { kind: 'add-context' | 'assign-component' }>,
  architecture: ArchitectureConfigDto,
  source: ConfigSourceDto,
): Failable<ArchitectureConfigDto> =>
  operation.kind === 'add-context'
    ? addContext(operation, architecture, source)
    : assignComponent(operation, architecture, source);

const architectureWrite = (
  rootDir: string,
  previous: ArchitectureConfigDto,
  next: ArchitectureConfigDto,
): Failable<ComputedChange> => ({
  ok: true,
  value: {
    file: 'architecture.yml',
    previousDocument: { ...previous },
    newDocument: { ...next },
    write: () => {
      const written = writeArchitectureConfig(rootDir, next);
      return written.ok ? { ok: true, value: undefined } : persistError(written.error.message);
    },
  },
});

const architectureChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'add-context' | 'assign-component' }>,
  architecture: ArchitectureConfigDto,
  source: ConfigSourceDto,
): Failable<ComputedChange> => {
  const computed = nextArchitecture(operation, architecture, source);
  return computed.ok ? architectureWrite(rootDir, architecture, computed.value) : computed;
};

/** §Z5 confirmation marker — same governed path, same audit entry, architecture.yml. */
const confirmationChange = (
  rootDir: string,
  operation: Extract<ConfigOperationDto, { kind: 'confirm-value' }>,
  documents: Documents,
): Failable<ComputedChange> => {
  const computed = nextArchitectureWithConfirmation(operation, documents, new Date().toISOString());
  return computed.ok
    ? architectureWrite(rootDir, documents.architecture, computed.value)
    : computed;
};
