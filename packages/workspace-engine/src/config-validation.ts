import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  readAliasesConfig,
  readArchitectureConfig,
  readRulesConfig,
  readWorkspaceConfig,
} from '@impactgraph/persistence';

import { crossFileMessages } from './config-validation-rules.js';

import type { Failable } from './failure.js';
import type { StorageError } from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

// `validate_configuration` (§Z13) — the same gate the governed operation path relies on, run
// over the COMMITTED documents without writing anything: per-file schema validity (an invalid
// document never replaces the last valid one) plus cross-file consistency.

const CONFIG_DIR = '.impactgraph';

export type ConfigFileName = 'config.yml' | 'architecture.yml' | 'aliases.yml' | 'rules.yml';

export interface ConfigFileValidation {
  readonly file: ConfigFileName;
  readonly present: boolean;
  readonly valid: boolean;
  readonly messages: readonly string[];
}

export interface ConfigValidationReport {
  readonly valid: boolean;
  readonly files: readonly ConfigFileValidation[];
  readonly crossFileMessages: readonly string[];
}

type Reader = (rootDir: string) => Result<unknown, StorageError>;

const READERS: readonly [ConfigFileName, Reader][] = [
  ['config.yml', readWorkspaceConfig],
  ['architecture.yml', readArchitectureConfig],
  ['aliases.yml', readAliasesConfig],
  ['rules.yml', readRulesConfig],
];

const validateFile = (
  rootDir: string,
  file: ConfigFileName,
  read: Reader,
): ConfigFileValidation => {
  const present = existsSync(join(rootDir, CONFIG_DIR, file));
  const result = read(rootDir);
  return {
    file,
    present,
    valid: result.ok,
    messages: result.ok ? [] : [result.error.message],
  };
};

/** §Z13 gate, read-only. Absent documents are valid — the empty v1 defaults apply. */
export const validateConfiguration = (rootDir: string): Failable<ConfigValidationReport> => {
  const files = READERS.map(([file, read]) => validateFile(rootDir, file, read));
  const cross = files.every((file) => file.valid) ? crossFileMessages(rootDir) : [];
  return {
    ok: true,
    value: {
      valid: files.every((file) => file.valid) && cross.length === 0,
      files,
      crossFileMessages: cross,
    },
  };
};
