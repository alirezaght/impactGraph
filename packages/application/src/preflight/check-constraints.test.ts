import { describe, expect, it } from 'vitest';

import { extractConstraints } from '../extract-constraints/extract-constraints.js';

import { checkConstraints } from './check-constraints.js';
import { deriveProposedEdges } from './proposed-edges.js';

import type { RepositoryConstraint } from '@impactgraph/domain';

/**
 * The failure this whole change exists to prevent, reproduced end to end: a real guard script, a
 * requirement written the way a specification writes one, and the two held against each other.
 */
const PEER_HTTP_GUARD = `#!/usr/bin/env python3
import re, sys
from pathlib import Path

SERVICE_DIRS = "services"
ALLOWLIST = [
    "services/newsletter-service/jobs/send.py",
]
PEER_HTTP = re.compile(r"https?://[a-z0-9-]+-service")

for path in Path(SERVICE_DIRS).rglob("*.py"):
    if str(path) in ALLOWLIST:
        continue
    if PEER_HTTP.search(path.read_text()):
        sys.exit(1)
`;

const constraints = (): readonly RepositoryConstraint[] =>
  extractConstraints({
    files: [{ path: 'ci/scripts/check-service-peer-http.py', content: PEER_HTTP_GUARD }],
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-12T00:00:00.000Z',
    nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
    nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
  }).constraints.filter((entry) => entry.kind === 'forbidden-runtime-call');

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`;

describe('checkConstraints — the peer-HTTP scenario', () => {
  const statement =
    'The newsletter service fetches subscriber preferences from the user-profile service over HTTP when rendering an issue.';

  it('reports a BLOCKING violation naming the requirement, the relationship and the guard', () => {
    const edges = deriveProposedEdges({
      requirementId: 'R6',
      statement,
      concepts: [
        {
          ref: 'newsletter service',
          nodeId: 'file:services/newsletter-service/api/routes.py',
          path: 'services/newsletter-service/api/routes.py',
        },
        {
          ref: 'user-profile service',
          nodeId: 'file:services/user-profile-service/app.py',
          path: 'services/user-profile-service/app.py',
        },
      ],
    });
    expect(edges.map((edge) => edge.mechanism)).toContain('http');

    const findings = checkConstraints({
      proposedEdges: edges,
      constraints: constraints(),
      nextId,
    });
    const blocking = findings.filter((finding) => finding.severity === 'blocking');
    expect(blocking).toHaveLength(1);
    const finding = blocking[0];
    expect(finding?.kind).toBe('blocking-constraint-violation');
    expect(finding?.requirementIds).toEqual(['R6']);
    expect(finding?.statement).toContain('R6');
    expect(finding?.statement).toContain('peer-service HTTP communication');
    expect(finding?.statement).toContain('ci/scripts/check-service-peer-http.py');
    expect(finding?.subject.proposedRelationship).toEqual({
      sourceRef: 'newsletter service',
      relation: 'CALLS_ENDPOINT',
      targetRef: 'user-profile service',
    });
    expect(finding?.evidenceIds.length).toBeGreaterThan(0);
    expect(finding?.recommendation).toContain('allowlisted');
  });

  it('raises no blocking violation when the call comes from the allowlisted send job', () => {
    const edges = deriveProposedEdges({
      requirementId: 'R6',
      statement,
      concepts: [
        {
          ref: 'newsletter service',
          nodeId: 'file:services/newsletter-service/jobs/send.py',
          path: 'services/newsletter-service/jobs/send.py',
        },
        {
          ref: 'user-profile service',
          nodeId: 'file:services/user-profile-service/app.py',
          path: 'services/user-profile-service/app.py',
        },
      ],
    });
    const findings = checkConstraints({ proposedEdges: edges, constraints: constraints(), nextId });
    expect(findings).toEqual([]);
  });

  it('warns rather than blocks when the endpoint did not resolve to indexed code', () => {
    const edges = deriveProposedEdges({
      requirementId: 'R6',
      statement,
      concepts: [{ ref: 'newsletter service' }, { ref: 'user-profile service' }],
    });
    const findings = checkConstraints({ proposedEdges: edges, constraints: constraints(), nextId });
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(findings.some((finding) => finding.kind === 'constraint-warning')).toBe(true);
  });

  it('never blocks on a constraint whose guard could not be parsed', () => {
    const opaque = extractConstraints({
      files: [{ path: 'ci/scripts/check-mystery.sh', content: '#!/bin/sh\nmake verify || exit 1\n' }],
      repositorySnapshotId: 'snap-1',
      createdAt: '2026-08-12T00:00:00.000Z',
      nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
      nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
    }).constraints;
    const edges = deriveProposedEdges({
      requirementId: 'R6',
      statement,
      concepts: [
        { ref: 'newsletter service', nodeId: 'n1', path: 'services/a.py' },
        { ref: 'user-profile service', nodeId: 'n2', path: 'services/b.py' },
      ],
    });
    const findings = checkConstraints({ proposedEdges: edges, constraints: opaque, nextId });
    expect(findings.some((finding) => finding.severity === 'blocking')).toBe(false);
  });
});

describe('deriveProposedEdges', () => {
  it('yields nothing when the requirement names fewer than two components', () => {
    expect(
      deriveProposedEdges({
        requirementId: 'R1',
        statement: 'The newsletter service calls the user-profile service over HTTP.',
        concepts: [{ ref: 'newsletter service' }],
      }),
    ).toEqual([]);
  });

  it('yields nothing when no mechanism is stated', () => {
    expect(
      deriveProposedEdges({
        requirementId: 'R1',
        statement: 'Subscriber preferences should be respected when rendering an issue.',
        concepts: [{ ref: 'newsletter service' }, { ref: 'user-profile service' }],
      }),
    ).toEqual([]);
  });

  it('reads an import relationship as a dependency proposal', () => {
    const edges = deriveProposedEdges({
      requirementId: 'R2',
      statement: 'The domain package imports the persistence adapter to load snapshots.',
      concepts: [
        { ref: 'domain package', path: 'packages/domain/src/index.ts' },
        { ref: 'persistence adapter', path: 'packages/persistence/src/index.ts' },
      ],
    });
    expect(edges.map((edge) => edge.mechanism)).toContain('import');
    expect(edges.find((edge) => edge.mechanism === 'import')?.source.ref).toBe('domain package');
  });
});
