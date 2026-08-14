import { describe, expect, it } from 'vitest';

import { createJavaAdapter } from './java-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// ADR-0020 §3 — a Java field's declared type was already parsed for receiver resolution
// (java-types.ts) and then discarded. It is now recorded on the field's symbol node, verbatim.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-java-types',
  analysisRunId: 'run-java-types',
  createdAt: '2026-08-14T09:00:00.000Z',
};

const PATH = 'src/main/java/com/example/Listing.java';

const index = (body: string): Promise<GraphFragment> =>
  createJavaAdapter().indexFiles(
    [
      {
        relativePath: PATH,
        content: `package com.example;

public class Listing {
${body}
}
`,
      },
    ],
    CONTEXT,
  );

const declaredTypeOf = (fragment: GraphFragment, name: string): string | undefined =>
  fragment.nodes.find((node) => node.type === 'symbol' && node.name === name)?.declaredType;

describe('Java field declared types (ADR-0020 §3)', () => {
  it('records the declared type verbatim, generics included', async () => {
    const fragment = await index(
      ['    private final UUID id = null;', '    private List<Deal> deals;'].join('\n'),
    );
    expect(declaredTypeOf(fragment, 'Listing.id')).toBe('UUID');
    expect(declaredTypeOf(fragment, 'Listing.deals')).toBe('List<Deal>');
  });

  it('gives every declarator of a shared declaration the same declared type', async () => {
    const fragment = await index('    private String first, second;');
    expect(declaredTypeOf(fragment, 'Listing.first')).toBe('String');
    expect(declaredTypeOf(fragment, 'Listing.second')).toBe('String');
  });

  it('keeps the field node type as symbol — no vocabulary churn in this round', async () => {
    const fragment = await index('    private final UUID id = null;');
    const field = fragment.nodes.find((node) => node.name === 'Listing.id');
    expect(field?.type).toBe('symbol');
  });
});
