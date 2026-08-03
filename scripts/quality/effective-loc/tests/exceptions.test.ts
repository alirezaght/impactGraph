import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LocExceptionsError, loadLocExceptions } from '../src/exceptions.js';

import type { LocExceptionsErrorKind } from '../src/exceptions.js';

const TODAY = '2026-07-31';

// Every root is tracked and removed: an unclean temp dir per test run adds up to thousands
// of orphaned directories in the OS temp folder over a project's life.
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'impactgraph-loc-exceptions-'));
  roots.push(root);
  return root;
}

function writeExceptionsFile(root: string, content: string): string {
  const filePath = path.join(root, 'loc-exceptions.json');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function createReferencedFile(root: string, relativePath: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'export const placeholder = 1;\n', 'utf8');
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: 'src/big-file.ts',
    reason: 'legacy parser table pending split',
    owner: 'alireza',
    reviewBy: '2026-12-31',
    maxLines: 400,
    ...overrides,
  };
}

function fileContent(entries: unknown[]): string {
  return JSON.stringify({ exceptions: entries }, null, 2);
}

function expectError(fn: () => unknown, kind: LocExceptionsErrorKind): LocExceptionsError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LocExceptionsError);
    const typed = error as LocExceptionsError;
    expect(typed.kind).toBe(kind);
    return typed;
  }
  throw new Error(`expected LocExceptionsError(${kind}) to be thrown`);
}

describe('loadLocExceptions', () => {
  it('loads a valid exceptions file into a map keyed by path', () => {
    const root = makeRoot();
    createReferencedFile(root, 'src/big-file.ts');
    const filePath = writeExceptionsFile(
      root,
      JSON.stringify({ $schema: './loc-exceptions.schema.json', exceptions: [entry()] }, null, 2),
    );
    const exceptions = loadLocExceptions({ filePath, rootDir: root, today: TODAY });
    expect(exceptions.size).toBe(1);
    expect(exceptions.get('src/big-file.ts')?.maxLines).toBe(400);
    expect(exceptions.get('src/big-file.ts')?.owner).toBe('alireza');
  });

  it('treats a missing exceptions file as no exceptions', () => {
    const root = makeRoot();
    const exceptions = loadLocExceptions({
      filePath: path.join(root, 'does-not-exist.json'),
      rootDir: root,
      today: TODAY,
    });
    expect(exceptions.size).toBe(0);
  });

  it('fails on malformed JSON', () => {
    const root = makeRoot();
    const filePath = writeExceptionsFile(root, '{ "exceptions": [');
    expectError(() => loadLocExceptions({ filePath, rootDir: root, today: TODAY }), 'parse');
  });

  it('fails on schema violations with issue details', () => {
    const root = makeRoot();
    const filePath = writeExceptionsFile(root, fileContent([entry({ maxLines: '400' })]));
    const error = expectError(
      () => loadLocExceptions({ filePath, rootDir: root, today: TODAY }),
      'schema',
    );
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('rejects impossible calendar dates', () => {
    const root = makeRoot();
    const filePath = writeExceptionsFile(root, fileContent([entry({ reviewBy: '2026-02-30' })]));
    expectError(() => loadLocExceptions({ filePath, rootDir: root, today: TODAY }), 'schema');
  });

  it('fails when an exception is expired and lists it', () => {
    const root = makeRoot();
    createReferencedFile(root, 'src/big-file.ts');
    const filePath = writeExceptionsFile(root, fileContent([entry({ reviewBy: '2026-01-01' })]));
    const error = expectError(
      () => loadLocExceptions({ filePath, rootDir: root, today: TODAY }),
      'expired',
    );
    expect(error.message).toContain('src/big-file.ts');
    expect(error.message).toContain('2026-01-01');
  });

  it('fails when an exception references a file that does not exist', () => {
    const root = makeRoot();
    const filePath = writeExceptionsFile(
      root,
      fileContent([entry({ path: 'src/missing-file.ts' })]),
    );
    const error = expectError(
      () => loadLocExceptions({ filePath, rootDir: root, today: TODAY }),
      'missing-file',
    );
    expect(error.details).toContain('src/missing-file.ts');
  });

  it('fails on duplicate paths', () => {
    const root = makeRoot();
    createReferencedFile(root, 'src/big-file.ts');
    const filePath = writeExceptionsFile(root, fileContent([entry(), entry({ maxLines: 500 })]));
    const error = expectError(
      () => loadLocExceptions({ filePath, rootDir: root, today: TODAY }),
      'duplicate-path',
    );
    expect(error.details).toContain('src/big-file.ts');
  });
});
