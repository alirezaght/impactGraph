import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { storageError } from '@impactgraph/application';
import { DEFAULT_WORKSPACE_CONFIG, workspaceConfigSchema } from '@impactgraph/contracts';
import { err, ok } from '@impactgraph/domain';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type { StorageError } from '@impactgraph/application';
import type { WorkspaceConfigDto } from '@impactgraph/contracts';
import type { Result } from '@impactgraph/domain';

// .impactgraph/ workspace config (PRD §16–17). YAML parsed safely (no custom tags), validated
// with the contracts schema on read and write, written atomically (temp + rename) so an invalid
// or interrupted write never replaces the last valid configuration (PRD §Z13).

export const IMPACTGRAPH_DIR = '.impactgraph';
export const CONFIG_FILE = 'config.yml';

const configPath = (rootDir: string): string => join(rootDir, IMPACTGRAPH_DIR, CONFIG_FILE);

export const isWorkspaceInitialized = (rootDir: string): boolean => existsSync(configPath(rootDir));

export const readWorkspaceConfig = (
  rootDir: string,
): Result<WorkspaceConfigDto | undefined, StorageError> => {
  const path = configPath(rootDir);
  if (!existsSync(path)) {
    return ok(undefined);
  }
  try {
    const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
    const parsed = workspaceConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        storageError(
          'validation',
          `invalid ${IMPACTGRAPH_DIR}/${CONFIG_FILE}: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
        ),
      );
    }
    return ok(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `cannot read workspace config: ${message}`));
  }
};

export const writeWorkspaceConfig = (
  rootDir: string,
  config: WorkspaceConfigDto,
): Result<void, StorageError> => {
  const validated = workspaceConfigSchema.safeParse(config);
  if (!validated.success) {
    return err(storageError('validation', 'refusing to write invalid workspace config'));
  }
  try {
    const target = configPath(rootDir);
    mkdirSync(join(rootDir, IMPACTGRAPH_DIR), { recursive: true });
    const temp = `${target}.tmp`;
    writeFileSync(temp, stringifyYaml(validated.data), 'utf8');
    renameSync(temp, target);
    return ok(undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `cannot write workspace config: ${message}`));
  }
};

export interface ScaffoldResult {
  readonly created: readonly string[];
  readonly alreadyInitialized: boolean;
}

/** `impactgraph init`: config + .gitignore so generated caches are never committed (PRD §16). */
export const ensureWorkspaceScaffold = (rootDir: string): Result<ScaffoldResult, StorageError> => {
  const created: string[] = [];
  const alreadyInitialized = isWorkspaceInitialized(rootDir);
  if (!alreadyInitialized) {
    const written = writeWorkspaceConfig(rootDir, DEFAULT_WORKSPACE_CONFIG);
    if (!written.ok) {
      return written;
    }
    created.push(`${IMPACTGRAPH_DIR}/${CONFIG_FILE}`);
  }
  try {
    const gitignorePath = join(rootDir, IMPACTGRAPH_DIR, '.gitignore');
    if (!existsSync(gitignorePath)) {
      mkdirSync(join(rootDir, IMPACTGRAPH_DIR), { recursive: true });
      writeFileSync(gitignorePath, 'cache/\nartifacts/\n', 'utf8');
      created.push(`${IMPACTGRAPH_DIR}/.gitignore`);
    }
    return ok({ created, alreadyInitialized });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `cannot scaffold workspace: ${message}`));
  }
};

/** Where the disposable SQLite index lives — inside the ignored cache directory (ADR-0006). */
export const indexDatabasePath = (rootDir: string): string =>
  join(rootDir, IMPACTGRAPH_DIR, 'cache', 'index.sqlite');
