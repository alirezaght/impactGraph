import { describe, expect, it } from 'vitest';

import {
  createRepositorySnapshot,
  parseRepositorySnapshot,
  serializeRepositorySnapshot,
} from '../index.js';

import type { CreateRepositorySnapshotInput } from '../index.js';

const validInput: CreateRepositorySnapshotInput = {
  id: 'snap-4f8a29c',
  repositoryIdentity: '/Users/dev/projects/deal-platform',
  head: { kind: 'branch', branch: 'main', commitSha: '4f8a29cde1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6' },
  dirtyWorkingTree: false,
  indexVersion: 1,
  createdAt: '2026-07-31T10:00:00.000Z',
};

describe('RepositorySnapshot (PRD §23.1)', () => {
  it('records identity, branch, commit, dirty flag, index version, and timestamp', () => {
    const result = createRepositorySnapshot(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repositoryIdentity).toBe('/Users/dev/projects/deal-platform');
      expect(result.value.head).toEqual({
        kind: 'branch',
        branch: 'main',
        commitSha: '4f8a29cde1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6',
      });
      expect(result.value.dirtyWorkingTree).toBe(false);
      expect(result.value.indexVersion).toBe(1);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it('supports a detached HEAD and a dirty working tree', () => {
    const result = createRepositorySnapshot({
      ...validInput,
      head: { kind: 'detached', commitSha: 'a1b2c3d' },
      dirtyWorkingTree: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.head.kind).toBe('detached');
      expect(result.value.dirtyWorkingTree).toBe(true);
    }
  });

  it('rejects blank ids and identities', () => {
    expect(createRepositorySnapshot({ ...validInput, id: ' ' }).ok).toBe(false);
    expect(createRepositorySnapshot({ ...validInput, repositoryIdentity: '' }).ok).toBe(false);
  });

  it('rejects malformed commit SHAs and blank branch names', () => {
    const badSha = createRepositorySnapshot({
      ...validInput,
      head: { kind: 'branch', branch: 'main', commitSha: 'not-a-sha!' },
    });
    expect(badSha.ok).toBe(false);
    if (!badSha.ok) {
      expect(badSha.error.issues.some((i) => i.code === 'invalid-commit')).toBe(true);
    }

    const blankBranch = createRepositorySnapshot({
      ...validInput,
      head: { kind: 'branch', branch: ' ', commitSha: 'a1b2c3d' },
    });
    expect(blankBranch.ok).toBe(false);
  });

  it('rejects non-positive or non-integer index versions and bad timestamps', () => {
    expect(createRepositorySnapshot({ ...validInput, indexVersion: 0 }).ok).toBe(false);
    expect(createRepositorySnapshot({ ...validInput, indexVersion: 1.5 }).ok).toBe(false);
    expect(createRepositorySnapshot({ ...validInput, createdAt: 'today' }).ok).toBe(false);
  });
});

describe('RepositorySnapshot serialization', () => {
  it('round-trips exactly and stamps a schemaVersion', () => {
    const result = createRepositorySnapshot(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const json = serializeRepositorySnapshot(result.value);
    expect(json.schemaVersion).toBe(1);
    const parsed = parseRepositorySnapshot(JSON.parse(JSON.stringify(json)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(result.value);
    }
  });

  it('rejects unknown head kinds and unsupported schema versions on parse', () => {
    const result = createRepositorySnapshot(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const json = serializeRepositorySnapshot(result.value);
    expect(parseRepositorySnapshot({ ...json, schemaVersion: 2 }).ok).toBe(false);
    expect(
      parseRepositorySnapshot({ ...json, head: { kind: 'tag', commitSha: 'a1b2c3d' } }).ok,
    ).toBe(false);
    expect(parseRepositorySnapshot('snapshot').ok).toBe(false);
  });
});
