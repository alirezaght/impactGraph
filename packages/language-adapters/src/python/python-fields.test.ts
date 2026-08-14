import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// ADR-0020 §3 — Python class attributes become `field` member nodes with a declared type: the
// SQLAlchemy/Pydantic shape the UUID/SQL near-miss needed. Only stated shapes are read — an
// annotation's verbatim text, or the type argument of Column()/mapped_column() — and anything
// computed is skipped, never guessed.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-fields',
  analysisRunId: 'run-fields',
  createdAt: '2026-08-14T09:00:00.000Z',
};

const index = (content: string): Promise<GraphFragment> =>
  createPythonAdapter().indexFiles([{ relativePath: 'app/models.py', content }], CONTEXT);

const fieldsOf = (
  fragment: GraphFragment,
): ReadonlyMap<string, { declaredType?: string; id: string }> =>
  new Map(
    fragment.nodes
      .filter((node) => node.type === 'field')
      .map((node) => [
        node.name,
        {
          id: String(node.id),
          ...(node.declaredType === undefined ? {} : { declaredType: node.declaredType }),
        },
      ]),
  );

const memberEdgeTargets = (fragment: GraphFragment, className: string): readonly string[] => {
  const classNode = fragment.nodes.find((node) => node.type === 'class' && node.name === className);
  return fragment.edges
    .filter((edge) => edge.type === 'DECLARES_MEMBER' && edge.sourceId === String(classNode?.id))
    .map((edge) => edge.targetId)
    .sort();
};

describe('Python class-attribute fields (ADR-0020 §3)', () => {
  it('reads annotated attributes verbatim — the Mapped[uuid.UUID] shape', async () => {
    const fragment = await index(`class Listing:
    id: Mapped[uuid.UUID]
    name: str = "unnamed"
`);
    const fields = fieldsOf(fragment);
    expect(fields.get('Listing.id')?.declaredType).toBe('Mapped[uuid.UUID]');
    expect(fields.get('Listing.name')?.declaredType).toBe('str');
    expect(memberEdgeTargets(fragment, 'Listing')).toEqual(
      [fields.get('Listing.id')?.id, fields.get('Listing.name')?.id].sort(),
    );
  });

  it('reads Column()/mapped_column() type arguments verbatim, dotted receivers included', async () => {
    const fragment = await index(`class Listing(Base):
    id = Column(UUID, primary_key=True)
    name = mapped_column(String(64), nullable=False)
    region = sa.Column(String(2))
`);
    const fields = fieldsOf(fragment);
    expect(fields.get('Listing.id')?.declaredType).toBe('UUID');
    expect(fields.get('Listing.name')?.declaredType).toBe('String(64)');
    expect(fields.get('Listing.region')?.declaredType).toBe('String(2)');
  });

  it('skips the optional leading name string of Column("…", TYPE)', async () => {
    const fragment = await index(`class Listing(Base):
    legacy = Column("legacy_id", Integer)
`);
    expect(fieldsOf(fragment).get('Listing.legacy')?.declaredType).toBe('Integer');
  });

  it('records the attribute without a type when Column() states none readable', async () => {
    const fragment = await index(`class Listing(Base):
    flags = Column(compute_type(), nullable=True)
`);
    const field = fieldsOf(fragment).get('Listing.flags');
    expect(field).toBeDefined();
    expect(field?.declaredType).toBeUndefined();
  });

  it('refuses plain assignments — a plain attribute is not a stated data shape', async () => {
    const fragment = await index(`class Config:
    DEBUG = True
    retries = compute()
    label = "static"
`);
    expect(fieldsOf(fragment).size).toBe(0);
  });

  it('leaves enum classes to the enum-member extractor — no double emission', async () => {
    const fragment = await index(`from enum import Enum


class ItemType(str, Enum):
    GESUCH = "gesuch"
`);
    expect(fieldsOf(fragment).size).toBe(0);
    expect(fragment.nodes.filter((node) => node.type === 'enum-member')).toHaveLength(1);
  });
});
