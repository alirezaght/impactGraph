import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { storageError } from '@impactgraph/application';
import { err, ok, parseSpecification, serializeSpecification } from '@impactgraph/domain';

import type { SpecificationStorePort, StorageError } from '@impactgraph/application';
import type { Result, Specification } from '@impactgraph/domain';

// Versioned JSON artifact store for specifications (ADR-0006: append-only system of record).
// One file per version; existing versions are never overwritten; writes are atomic.

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const versionFile = (dir: string, id: string, version: number): string =>
  join(dir, 'specifications', id, `v${String(version)}.json`);

const listVersionNumbers = (dir: string, id: string): number[] => {
  const specDir = join(dir, 'specifications', id);
  if (!existsSync(specDir)) {
    return [];
  }
  return readdirSync(specDir)
    .map((name) => /^v(\d+)\.json$/.exec(name)?.[1])
    .filter((match): match is string => match !== undefined)
    .map((match) => Number(match))
    .sort((a, b) => a - b);
};

class SpecificationArtifactStore implements SpecificationStorePort {
  private readonly baseDir: string;

  public constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  public saveVersion(specification: Specification): Promise<Result<void, StorageError>> {
    if (!SAFE_ID.test(specification.id)) {
      return Promise.resolve(
        err(storageError('validation', `unsafe specification id '${specification.id}'`)),
      );
    }
    const target = versionFile(this.baseDir, specification.id, specification.version);
    if (existsSync(target)) {
      return Promise.resolve(
        err(
          storageError(
            'validation',
            `version ${String(specification.version)} of '${specification.id}' already exists — versions are immutable`,
          ),
        ),
      );
    }
    try {
      mkdirSync(join(this.baseDir, 'specifications', specification.id), { recursive: true });
      const temp = `${target}.tmp`;
      writeFileSync(temp, JSON.stringify(serializeSpecification(specification), null, 2), 'utf8');
      renameSync(temp, target);
      return Promise.resolve(ok(undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', message)));
    }
  }

  public getVersion(
    id: string,
    version: number,
  ): Promise<Result<Specification | undefined, StorageError>> {
    if (!SAFE_ID.test(id)) {
      return Promise.resolve(err(storageError('validation', `unsafe specification id '${id}'`)));
    }
    const target = versionFile(this.baseDir, id, version);
    if (!existsSync(target)) {
      return Promise.resolve(ok(undefined));
    }
    try {
      const parsed = parseSpecification(JSON.parse(readFileSync(target, 'utf8')));
      if (!parsed.ok) {
        return Promise.resolve(
          err(storageError('corruption', `stored specification failed validation`)),
        );
      }
      return Promise.resolve(ok(parsed.value));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', message)));
    }
  }

  public async getLatest(id: string): Promise<Result<Specification | undefined, StorageError>> {
    const versions = await this.listVersions(id);
    if (!versions.ok) {
      return versions;
    }
    const latest = versions.value[versions.value.length - 1];
    if (latest === undefined) {
      return ok(undefined);
    }
    return this.getVersion(id, latest);
  }

  public listVersions(id: string): Promise<Result<readonly number[], StorageError>> {
    if (!SAFE_ID.test(id)) {
      return Promise.resolve(err(storageError('validation', `unsafe specification id '${id}'`)));
    }
    try {
      return Promise.resolve(ok(listVersionNumbers(this.baseDir, id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', message)));
    }
  }
}

export const createSpecificationArtifactStore = (baseDir: string): SpecificationStorePort =>
  new SpecificationArtifactStore(baseDir);

/** Default artifacts location — ignored by the scaffolded .impactgraph/.gitignore. */
export const artifactsPath = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts');
