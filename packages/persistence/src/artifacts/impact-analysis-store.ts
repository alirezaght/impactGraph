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
import { err, ok, parseImpactAnalysis, serializeImpactAnalysis } from '@impactgraph/domain';

import type { ImpactAnalysisStorePort, StorageError } from '@impactgraph/application';
import type { AnalysisStatus, ImpactAnalysis, Result } from '@impactgraph/domain';

// Append-only analysis artifacts (PRD §40.3, ADR-0006). Re-saving an id is legal only for
// forward status transitions and decision appends on unapproved analyses — an approved
// analysis's content can never change by any code path.

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const LEGAL_TRANSITIONS: Readonly<Record<AnalysisStatus, readonly AnalysisStatus[]>> = {
  draft: ['draft', 'reviewed', 'approved', 'superseded'],
  reviewed: ['reviewed', 'approved', 'superseded'],
  approved: ['approved', 'superseded'],
  superseded: ['superseded'],
};

const frozenContent = (analysis: ImpactAnalysis): string =>
  JSON.stringify({ ...analysis, status: undefined, userDecisions: undefined });

const decisionsArePrefix = (previous: ImpactAnalysis, next: ImpactAnalysis): boolean =>
  previous.userDecisions.length <= next.userDecisions.length &&
  previous.userDecisions.every(
    (decision, index) => JSON.stringify(decision) === JSON.stringify(next.userDecisions[index]),
  );

const updateIssue = (previous: ImpactAnalysis, next: ImpactAnalysis): string | undefined => {
  if (!LEGAL_TRANSITIONS[previous.status].includes(next.status)) {
    return `illegal status transition '${previous.status}' → '${next.status}'`;
  }
  if (frozenContent(previous) !== frozenContent(next)) {
    return 'analysis content is immutable — only status and appended decisions may change';
  }
  if (!decisionsArePrefix(previous, next)) {
    return 'user decisions are append-only';
  }
  const frozen = previous.status === 'approved' || previous.status === 'superseded';
  if (frozen && next.userDecisions.length !== previous.userDecisions.length) {
    return 'decisions cannot be added after approval';
  }
  return undefined;
};

class ImpactAnalysisArtifactStore implements ImpactAnalysisStorePort {
  private readonly dir: string;

  public constructor(baseDir: string) {
    this.dir = join(baseDir, 'analyses');
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private read(id: string): Result<ImpactAnalysis | undefined, StorageError> {
    const target = this.file(id);
    if (!existsSync(target)) {
      return ok(undefined);
    }
    try {
      const parsed = parseImpactAnalysis(JSON.parse(readFileSync(target, 'utf8')));
      return parsed.ok
        ? ok(parsed.value)
        : err(storageError('corruption', 'stored analysis failed validation'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(storageError('io', message));
    }
  }

  public save(analysis: ImpactAnalysis): Promise<Result<void, StorageError>> {
    if (!SAFE_ID.test(analysis.id)) {
      return Promise.resolve(
        err(storageError('validation', `unsafe analysis id '${analysis.id}'`)),
      );
    }
    const existing = this.read(analysis.id);
    if (!existing.ok) {
      return Promise.resolve(existing);
    }
    if (existing.value !== undefined) {
      const issue = updateIssue(existing.value, analysis);
      if (issue !== undefined) {
        return Promise.resolve(err(storageError('validation', issue)));
      }
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      const target = this.file(analysis.id);
      const temp = `${target}.tmp`;
      writeFileSync(temp, JSON.stringify(serializeImpactAnalysis(analysis), null, 2), 'utf8');
      renameSync(temp, target);
      return Promise.resolve(ok(undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', message)));
    }
  }

  public get(id: string): Promise<Result<ImpactAnalysis | undefined, StorageError>> {
    if (!SAFE_ID.test(id)) {
      return Promise.resolve(err(storageError('validation', `unsafe analysis id '${id}'`)));
    }
    return Promise.resolve(this.read(id));
  }

  public async listBySpecification(
    specificationId: string,
  ): Promise<Result<readonly ImpactAnalysis[], StorageError>> {
    const all = await this.listAll();
    if (!all.ok) {
      return all;
    }
    return ok(all.value.filter((analysis) => analysis.specificationId === specificationId));
  }

  public async listAll(): Promise<Result<readonly ImpactAnalysis[], StorageError>> {
    if (!existsSync(this.dir)) {
      return ok([]);
    }
    const analyses: ImpactAnalysis[] = [];
    for (const name of readdirSync(this.dir).sort()) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const loaded = await this.get(name.slice(0, -'.json'.length));
      if (!loaded.ok) {
        return loaded;
      }
      if (loaded.value !== undefined) {
        analyses.push(loaded.value);
      }
    }
    return ok(analyses);
  }
}

export const createImpactAnalysisArtifactStore = (baseDir: string): ImpactAnalysisStorePort =>
  new ImpactAnalysisArtifactStore(baseDir);
