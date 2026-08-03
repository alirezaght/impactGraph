import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { storageError } from '@impactgraph/application';
import {
  aliasesConfigSchema,
  architectureConfigSchema,
  DEFAULT_ALIASES_CONFIG,
  DEFAULT_ARCHITECTURE_CONFIG,
  DEFAULT_RULES_CONFIG,
  rulesConfigSchema,
} from '@impactgraph/contracts';
import { err, ok } from '@impactgraph/domain';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { IMPACTGRAPH_DIR } from './config-store.js';

import type { StorageError } from '@impactgraph/application';
import type {
  AliasesConfigDto,
  ArchitectureConfigDto,
  RulesConfigDto,
} from '@impactgraph/contracts';
import type { Result } from '@impactgraph/domain';
import type { ZodType } from 'zod';

// The committed project-knowledge files (PRD §16): architecture.yml, aliases.yml, rules.yml.
// Same guarantees as config.yml — safe YAML parse, schema validation on read AND write, atomic
// temp+rename writes, and an invalid document never replaces the last valid one (§Z13).

export const ARCHITECTURE_FILE = 'architecture.yml';
export const ALIASES_FILE = 'aliases.yml';
export const RULES_FILE = 'rules.yml';

const readYamlConfig = <T>(
  rootDir: string,
  file: string,
  schema: ZodType<T>,
): Result<T | undefined, StorageError> => {
  const path = join(rootDir, IMPACTGRAPH_DIR, file);
  if (!existsSync(path)) {
    return ok(undefined);
  }
  try {
    const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return err(
        storageError(
          'validation',
          `invalid ${IMPACTGRAPH_DIR}/${file}: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
        ),
      );
    }
    return ok(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `cannot read ${file}: ${message}`));
  }
};

const writeYamlConfig = <T>(
  rootDir: string,
  file: string,
  schema: ZodType<T>,
  value: T,
): Result<void, StorageError> => {
  const validated = schema.safeParse(value);
  if (!validated.success) {
    // Validation gate before the atomic rename: the last valid file stays untouched (§Z13).
    return err(storageError('validation', `refusing to write invalid ${file}`));
  }
  try {
    const target = join(rootDir, IMPACTGRAPH_DIR, file);
    mkdirSync(join(rootDir, IMPACTGRAPH_DIR), { recursive: true });
    const temp = `${target}.tmp`;
    writeFileSync(temp, stringifyYaml(validated.data), 'utf8');
    renameSync(temp, target);
    return ok(undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `cannot write ${file}: ${message}`));
  }
};

export const readArchitectureConfig = (
  rootDir: string,
): Result<ArchitectureConfigDto | undefined, StorageError> =>
  readYamlConfig(rootDir, ARCHITECTURE_FILE, architectureConfigSchema);

export const writeArchitectureConfig = (
  rootDir: string,
  value: ArchitectureConfigDto,
): Result<void, StorageError> =>
  writeYamlConfig(rootDir, ARCHITECTURE_FILE, architectureConfigSchema, value);

export const readAliasesConfig = (
  rootDir: string,
): Result<AliasesConfigDto | undefined, StorageError> =>
  readYamlConfig(rootDir, ALIASES_FILE, aliasesConfigSchema);

export const writeAliasesConfig = (
  rootDir: string,
  value: AliasesConfigDto,
): Result<void, StorageError> => writeYamlConfig(rootDir, ALIASES_FILE, aliasesConfigSchema, value);

export const readRulesConfig = (
  rootDir: string,
): Result<RulesConfigDto | undefined, StorageError> =>
  readYamlConfig(rootDir, RULES_FILE, rulesConfigSchema);

export const writeRulesConfig = (
  rootDir: string,
  value: RulesConfigDto,
): Result<void, StorageError> => writeYamlConfig(rootDir, RULES_FILE, rulesConfigSchema, value);

/** `impactgraph init`: create any missing project-knowledge files with empty v1 defaults. */
export const scaffoldProjectKnowledgeFiles = (
  rootDir: string,
): Result<readonly string[], StorageError> => {
  const created: string[] = [];
  const targets: readonly [string, () => Result<void, StorageError>][] = [
    [ARCHITECTURE_FILE, () => writeArchitectureConfig(rootDir, DEFAULT_ARCHITECTURE_CONFIG)],
    [ALIASES_FILE, () => writeAliasesConfig(rootDir, DEFAULT_ALIASES_CONFIG)],
    [RULES_FILE, () => writeRulesConfig(rootDir, DEFAULT_RULES_CONFIG)],
  ];
  for (const [file, write] of targets) {
    if (existsSync(join(rootDir, IMPACTGRAPH_DIR, file))) {
      continue;
    }
    const written = write();
    if (!written.ok) {
      return written;
    }
    created.push(`${IMPACTGRAPH_DIR}/${file}`);
  }
  return ok(created);
};
