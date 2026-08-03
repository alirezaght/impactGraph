import ts from 'typescript';

import { fileNodeId } from '../fallback/fallback-adapter.js';
import { deterministicEnvelope } from '../fragment-builder.js';

import { envAccessName } from './env-access.js';
import { evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

// Story 3.4 — environment-variable references (PRD §15.1): `process.env.X` and
// `process.env['X']` become environment-variable nodes with CONFIGURES edges to the file.
//
// The shape reader lives in `env-access.ts` because `parse-pubsub.ts` needs exactly the same
// judgement for a different purpose (epic-16), and two readers would eventually disagree.

export const collectEnvReferences = (state: ParseState): void => {
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = envAccessName(node);
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      emitEnvFact(state, node, name);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(state.source, visit);
};

const emitEnvFact = (state: ParseState, node: ts.Node, name: string): void => {
  const range = rangeOf(state.source, node);
  const evidenceId = state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'config-entry', range),
      kind: 'config-entry',
      source: { kind: 'file', filePath: state.filePath, range, symbolName: name },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  const envNodeId = `env:${name}`;
  state.builder.addNode(
    {
      id: envNodeId,
      category: 'infrastructure',
      type: 'environment-variable',
      name,
      path: state.filePath,
      knowledge: deterministicEnvelope(state.context, [evidenceId]),
    },
    state.filePath,
  );
  state.builder.addEdge(
    {
      id: `configures:${envNodeId}->${fileNodeId(state.filePath)}`,
      type: 'CONFIGURES',
      sourceId: envNodeId,
      targetId: fileNodeId(state.filePath),
      knowledge: deterministicEnvelope(state.context, [evidenceId]),
    },
    state.filePath,
  );
};
