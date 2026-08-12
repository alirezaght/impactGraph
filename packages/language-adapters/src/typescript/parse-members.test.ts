import { describe, expect, it } from 'vitest';

import { createTypeScriptAdapter } from './typescript-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// ADR-0017 — symbol members. `ItemType.ANGEBOT` was assumed, implemented against, and did not
// exist: `ItemType` resolved, so the reference resolved, because nothing modelled what was inside.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-members',
  analysisRunId: 'run-members',
  createdAt: '2026-08-12T00:00:00.000Z',
};

const index = (content: string): Promise<GraphFragment> =>
  createTypeScriptAdapter().indexFiles([{ relativePath: 'src/item-type.ts', content }], CONTEXT);

const membersOf = (fragment: GraphFragment, container: string): readonly string[] => {
  const containerNode = fragment.nodes.find(
    (node) => node.name === container && node.type === 'enum',
  );
  if (containerNode === undefined) {
    return [];
  }
  return fragment.edges
    .filter((edge) => edge.type === 'DECLARES_MEMBER' && edge.sourceId === String(containerNode.id))
    .map((edge) => fragment.nodes.find((node) => String(node.id) === edge.targetId)?.name ?? '')
    .sort();
};

describe('symbol member extraction', () => {
  it('declares the members of a TypeScript enum', async () => {
    const fragment = await index(`export enum ItemType {
  GESUCH = 'gesuch',
  IMMOBILIE = 'immobilie',
}
`);
    expect(membersOf(fragment, 'ItemType')).toEqual(['GESUCH', 'IMMOBILIE']);
  });

  it('declares the literals of a string-union type', async () => {
    const fragment = await index(`export type ItemType = 'GESUCH' | 'IMMOBILIE';\n`);
    expect(membersOf(fragment, 'ItemType')).toEqual(['GESUCH', 'IMMOBILIE']);
  });

  it('declares the keys of a const object used as an enum', async () => {
    const fragment = await index(
      `export const ItemType = { GESUCH: 'gesuch', IMMOBILIE: 'immobilie' } as const;\n`,
    );
    expect(membersOf(fragment, 'ItemType')).toEqual(['GESUCH', 'IMMOBILIE']);
  });

  it('emits nothing for a union it cannot fully enumerate', async () => {
    const fragment = await index(`export type ItemType = 'GESUCH' | SomeImportedType;\n`);
    expect(membersOf(fragment, 'ItemType')).toEqual([]);
  });

  it('emits nothing for an object with a spread, whose member set it never fully read', async () => {
    const fragment = await index(
      `const base = {};\nexport const ItemType = { ...base, GESUCH: 'gesuch' } as const;\n`,
    );
    expect(membersOf(fragment, 'ItemType')).toEqual([]);
  });

  it('cites the member declaration as evidence', async () => {
    const fragment = await index(`export enum ItemType {\n  GESUCH = 'gesuch',\n}\n`);
    const member = fragment.nodes.find((node) => node.type === 'enum-member');
    expect(member).toBeDefined();
    expect(member?.knowledge.evidenceIds.length).toBeGreaterThan(0);
    const evidence = fragment.evidence.find(
      (entry) => entry.id === member?.knowledge.evidenceIds[0],
    );
    expect(evidence?.kind).toBe('symbol-declaration');
  });
});
