import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// ADR-0017 — the ItemType.ANGEBOT failure, in the language it happened in.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-members',
  analysisRunId: 'run-members',
  createdAt: '2026-08-12T00:00:00.000Z',
};

const index = (content: string): Promise<GraphFragment> =>
  createPythonAdapter().indexFiles([{ relativePath: 'app/item_type.py', content }], CONTEXT);

const membersOf = (fragment: GraphFragment, container: string): readonly string[] => {
  const containerNode = fragment.nodes.find(
    (node) => node.name === container && node.type === 'class',
  );
  if (containerNode === undefined) {
    return [];
  }
  return fragment.edges
    .filter((edge) => edge.type === 'DECLARES_MEMBER' && edge.sourceId === String(containerNode.id))
    .map((edge) => fragment.nodes.find((node) => String(node.id) === edge.targetId)?.name ?? '')
    .sort();
};

describe('Python enum member extraction', () => {
  it('declares the members of an Enum subclass', async () => {
    const fragment = await index(`from enum import Enum


class ItemType(str, Enum):
    GESUCH = "gesuch"
    IMMOBILIE = "immobilie"
`);
    expect(membersOf(fragment, 'ItemType')).toEqual(['GESUCH', 'IMMOBILIE']);
  });

  it('emits nothing for a plain class, whose attributes are not a closed set', async () => {
    const fragment = await index(`class ItemType:
    GESUCH = "gesuch"
`);
    expect(membersOf(fragment, 'ItemType')).toEqual([]);
  });
});
