import { describe, expect, it } from 'vitest';

import {
  bestFileHit,
  dependencyPickItems,
  impactPickItems,
  impactsTouching,
  nodeIdsForFile,
  selectionSpecName,
  stackSummaryMessage,
} from './editor-context-items.js';

import type { RequirementImpact } from '@impactgraph/domain';
import type { ComponentHit, NodeExplanation } from '@impactgraph/workspace-engine';

const hit = (nodeId: string, type: string, path?: string): ComponentHit => ({
  nodeId,
  name: nodeId,
  category: 'code',
  type,
  path,
  provenance: 'static-analysis',
});

const impact = (overrides: Partial<RequirementImpact>): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId: 'sym:service',
  likelihood: 'required',
  impactType: 'business-rule',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'direct-import', contribution: 0.4 }],
  explanation: 'imports the changed module',
  expectedChanges: [],
  evidenceIds: ['ev-1'],
  dependencyPath: ['sym:service'],
  provenance: 'static-analysis',
  ...overrides,
});

describe('detection-review summary (§10.1 step 6)', () => {
  it('lists languages, frameworks, and signals as text', () => {
    expect(
      stackSummaryMessage({
        languages: ['typescript', 'python'],
        frameworks: ['nestjs'],
        signals: ['migrations', 'ci'],
      }),
    ).toBe('languages: typescript, python · frameworks: nestjs · signals: migrations, ci');
  });

  it('says "none detected" instead of hiding empty categories', () => {
    expect(stackSummaryMessage({ languages: [], frameworks: [], signals: [] })).toBe(
      'languages: none detected · frameworks: none detected · signals: none detected',
    );
  });
});

describe('file → graph node resolution (Story 7.5)', () => {
  const hits = [
    hit('sym:a', 'function', 'src/a.ts'),
    hit('file:src/a.ts', 'file', 'src/a.ts'),
    hit('file:src/b.ts', 'file', 'src/b.ts'),
  ];

  it('prefers the file-typed node on an exact path match', () => {
    expect(bestFileHit(hits, 'src/a.ts')?.nodeId).toBe('file:src/a.ts');
  });

  it('falls back to any node in the file, and to undefined when nothing matches', () => {
    expect(bestFileHit([hit('sym:a', 'function', 'src/a.ts')], 'src/a.ts')?.nodeId).toBe('sym:a');
    expect(bestFileHit(hits, 'src/missing.ts')).toBeUndefined();
  });

  it('collects every node id located in the file', () => {
    expect([...nodeIdsForFile(hits, 'src/a.ts')]).toEqual(['sym:a', 'file:src/a.ts']);
  });
});

describe('dependency quick-pick items (§19 Show Architectural Dependencies)', () => {
  it('lists outgoing then incoming edges with direction and type as text (§37)', () => {
    const explanation = {
      outgoingEdges: [{ edgeId: 'e1', type: 'IMPORTS', to: 'file:b', toName: 'b.ts' }],
      incomingEdges: [{ edgeId: 'e2', type: 'CALLS', from: 'sym:c', fromName: 'c()' }],
    } as unknown as NodeExplanation;
    expect(dependencyPickItems(explanation)).toEqual([
      { label: '→ b.ts', description: 'IMPORTS (outgoing)', nodeId: 'file:b' },
      { label: '← c()', description: 'CALLS (incoming)', nodeId: 'sym:c' },
    ]);
  });
});

describe('impacts touching a file (§19 Show Requirement Impacts)', () => {
  it('matches on the impact node or any dependency-path node, never invents matches', () => {
    const impacts = [
      impact({ nodeId: 'sym:service' }),
      impact({ nodeId: 'sym:other', dependencyPath: ['sym:service', 'sym:other'] }),
      impact({ nodeId: 'sym:unrelated', dependencyPath: ['sym:unrelated'] }),
    ];
    const touching = impactsTouching(impacts, new Set(['sym:service']));
    expect(touching.map((entry) => entry.nodeId)).toEqual(['sym:service', 'sym:other']);
  });

  it('renders likelihood, type, confidence, and provenance as text on each item (§3/§37)', () => {
    const [item] = impactPickItems([impact({})]);
    expect(item?.label).toBe('required · sym:service');
    expect(item?.description).toBe('business-rule · 0.90 · static-analysis · req-1');
    expect(item?.detail).toBe('imports the changed module');
  });
});

describe('selection spec naming (§19 Analyze Selection)', () => {
  it('records the file and 1-based line range', () => {
    expect(selectionSpecName('docs/spec.md', 3, 12)).toBe('selection docs/spec.md:3-12');
  });
});
