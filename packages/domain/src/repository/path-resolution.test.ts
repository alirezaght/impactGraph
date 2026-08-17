import { describe, expect, it } from 'vitest';

import { normalizePathReference, resolvePathReference } from './path-resolution.js';

// Scope-aware path resolution ("required must mean strong"): a specification frequently writes
// paths relative to the package or service it discusses ("src/build-impact-model/x.ts" relative
// to packages/application), while the graph indexes workspace-relative paths. A unique
// path-boundary suffix match is the same claim as a verbatim path; a suffix that matches several
// places is a question, never an anchor.

interface TestNode {
  readonly id: string;
  readonly path?: string;
}

const nodeAt = (id: string, path?: string): TestNode => ({
  id,
  ...(path === undefined ? {} : { path }),
});

describe('normalizePathReference', () => {
  it('strips leading ./ segments and surrounding whitespace', () => {
    expect(normalizePathReference(' ./src/index.ts ')).toBe('src/index.ts');
    expect(normalizePathReference('././src/index.ts')).toBe('src/index.ts');
  });

  it('leaves an already-relative reference alone', () => {
    expect(normalizePathReference('src/index.ts')).toBe('src/index.ts');
  });
});

describe('resolvePathReference', () => {
  const nodes = [
    nodeAt('file:app-cm', 'packages/application/src/build-impact-model/concept-matching.ts'),
    nodeAt('file:domain-index', 'packages/domain/src/index.ts'),
    nodeAt('file:app-index', 'packages/application/src/index.ts'),
    nodeAt('symbol:pathless'),
  ];

  it('resolves a verbatim workspace-relative path first', () => {
    const resolution = resolvePathReference('packages/domain/src/index.ts', nodes);
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind === 'resolved') {
      expect(resolution.via).toBe('verbatim');
      expect(resolution.nodes.map((node) => node.id)).toEqual(['file:domain-index']);
    }
  });

  it('resolves a unique path-boundary suffix as a scoped resolution', () => {
    const resolution = resolvePathReference('src/build-impact-model/concept-matching.ts', nodes);
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind === 'resolved') {
      expect(resolution.via).toBe('suffix');
      expect(resolution.nodes.map((node) => node.id)).toEqual(['file:app-cm']);
      expect(resolution.path).toBe(
        'packages/application/src/build-impact-model/concept-matching.ts',
      );
    }
  });

  it('normalizes a leading ./ before matching', () => {
    const resolution = resolvePathReference('./src/build-impact-model/concept-matching.ts', nodes);
    expect(resolution.kind).toBe('resolved');
  });

  it('reports a suffix matching several places as ambiguous with the candidate paths', () => {
    const resolution = resolvePathReference('src/index.ts', nodes);
    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind === 'ambiguous') {
      expect(resolution.candidatePaths).toEqual([
        'packages/application/src/index.ts',
        'packages/domain/src/index.ts',
      ]);
    }
  });

  it('never matches across a path-segment boundary', () => {
    // 'rc/index.ts' is not a path suffix of 'packages/domain/src/index.ts'.
    expect(resolvePathReference('rc/index.ts', nodes).kind).toBe('unresolved');
  });

  it('returns unresolved when nothing matches', () => {
    expect(resolvePathReference('src/missing.ts', nodes).kind).toBe('unresolved');
    expect(resolvePathReference('', nodes).kind).toBe('unresolved');
  });

  it('compares case-insensitively, the way specifications quote paths', () => {
    const resolution = resolvePathReference('SRC/build-impact-model/Concept-Matching.ts', nodes);
    expect(resolution.kind).toBe('resolved');
  });

  it('returns every node indexed at the one matched path', () => {
    const shared = [
      nodeAt('file:routes', 'services/api/src/routes.py'),
      nodeAt('symbol:handler', 'services/api/src/routes.py'),
    ];
    const resolution = resolvePathReference('src/routes.py', shared);
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind === 'resolved') {
      expect(resolution.nodes.map((node) => node.id).sort()).toEqual([
        'file:routes',
        'symbol:handler',
      ]);
    }
  });
});
