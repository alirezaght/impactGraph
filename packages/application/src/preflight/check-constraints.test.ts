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
      files: [
        { path: 'ci/scripts/check-mystery.sh', content: '#!/bin/sh\nmake verify || exit 1\n' },
      ],
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

describe('checkConstraints — exemption precision', () => {
  it('does not exempt an edge whose endpoint ref is merely a substring of an allowlist entry', () => {
    // 'newsletter-service' is a substring of 'services/newsletter-service/jobs/send.py'; the
    // allowlist names ONE file, not everything mentioning the service.
    const findings = checkConstraints({
      proposedEdges: [
        {
          requirementId: 'R6',
          source: {
            ref: 'newsletter service',
            nodeId: 'file:routes',
            path: 'services/newsletter-service/api/issue_routes.py',
          },
          target: { ref: 'newsletter-service', nodeId: 'run:svc', path: 'infra/main.tf' },
          mechanism: 'http',
          relation: 'CALLS_ENDPOINT',
          quote: 'fetches over HTTP',
          confidence: 0.85,
        },
      ],
      constraints: constraints(),
      nextId,
    });
    expect(findings.some((finding) => finding.severity === 'blocking')).toBe(true);
  });
});

describe('checkConstraints — layering rules (boundaries/element-types)', () => {
  const CONFIG = `export default [{
    settings: { 'boundaries/elements': [
      { type: 'domain', pattern: 'packages/domain' },
      { type: 'application', pattern: 'packages/application' },
      { type: 'adapter', pattern: 'packages/persistence' },
    ] },
    rules: { 'boundaries/element-types': ['error', { default: 'disallow', rules: [
      { from: 'application', allow: ['domain'] },
    ] }] },
  }];`;

  const layering = (): readonly RepositoryConstraint[] =>
    extractConstraints({
      files: [{ path: 'eslint.config.mjs', content: CONFIG }],
      repositorySnapshotId: 'snap-1',
      createdAt: '2026-08-12T00:00:00.000Z',
      nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
      nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
    }).constraints.filter((entry) => entry.kind === 'boundary-restriction');

  const edge = (
    source: { ref: string; path?: string },
    target: { ref: string; path?: string },
  ) => ({
    requirementId: 'R1',
    source: { nodeId: `n:${source.ref}`, ...source },
    target: { nodeId: `n:${target.ref}`, ...target },
    mechanism: 'import' as const,
    relation: 'IMPORTS',
    quote: 'imports',
    confidence: 0.85,
  });

  it('blocks a proposal for the default-disallow layer to import an internal package', () => {
    const findings = checkConstraints({
      proposedEdges: [
        edge(
          { ref: 'packages/domain', path: 'packages/domain/package.json' },
          { ref: '@impactgraph/persistence', path: 'packages/persistence/package.json' },
        ),
      ],
      constraints: layering(),
      nextId,
    });
    expect(findings.some((finding) => finding.severity === 'blocking')).toBe(true);
    expect(findings[0]?.statement).toContain("'domain' layer");
  });

  it('permits the allowed direction', () => {
    const findings = checkConstraints({
      proposedEdges: [
        edge(
          { ref: 'packages/application', path: 'packages/application/package.json' },
          { ref: '@impactgraph/domain', path: 'packages/domain/package.json' },
        ),
      ],
      constraints: layering(),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('does not govern an external library with an internal layering rule', () => {
    // "application may only depend on domain" is about internal elements; `lodash` is not one.
    const findings = checkConstraints({
      proposedEdges: [
        edge(
          { ref: 'packages/application', path: 'packages/application/package.json' },
          { ref: 'lodash' },
        ),
      ],
      constraints: layering(),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('does not apply one layer rule to a source in a different layer', () => {
    const findings = checkConstraints({
      proposedEdges: [
        edge(
          { ref: 'packages/persistence', path: 'packages/persistence/src/store.ts' },
          { ref: '@impactgraph/application', path: 'packages/application/package.json' },
        ),
      ],
      constraints: layering().filter((entry) => entry.scope.roles?.includes('domain') === true),
      nextId,
    });
    expect(findings).toEqual([]);
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

  it('pairs the two components in different containers, not the first two mentioned', () => {
    // The requirement names its own file (issue_routes.py) alongside both services. The
    // relationship the constraint must see is newsletter → user-profile, and pairing "the first
    // two concepts" would silently drop the target and check nothing.
    const edges = deriveProposedEdges({
      requirementId: 'R1',
      statement:
        'The newsletter service fetches subscriber preferences from the user-profile service over HTTP while rendering an issue in issue_routes.py.',
      concepts: [
        {
          ref: 'issue_routes.py',
          nodeId: 'file:routes',
          path: 'services/newsletter-service/api/issue_routes.py',
        },
        {
          ref: 'newsletter service',
          nodeId: 'file:routes',
          path: 'services/newsletter-service/api/issue_routes.py',
        },
        {
          ref: 'user-profile service',
          nodeId: 'file:profile',
          path: 'services/user-profile-service/app.py',
        },
      ],
    });
    const http = edges.find((edge) => edge.mechanism === 'http');
    expect(http?.source.ref).toBe('newsletter service');
    expect(http?.target.ref).toBe('user-profile service');
  });

  it('drops a concept that is a text fragment of another concept in the same requirement', () => {
    const edges = deriveProposedEdges({
      requirementId: 'R1',
      statement:
        'The newsletter service fetches subscriber preferences from the user-profile service over HTTP.',
      concepts: [
        { ref: 'user-profile' },
        {
          ref: 'newsletter service',
          nodeId: 'file:routes',
          path: 'services/newsletter-service/api/issue_routes.py',
        },
        {
          ref: 'user-profile service',
          nodeId: 'file:profile',
          path: 'services/user-profile-service/app.py',
        },
      ],
    });
    const http = edges.find((edge) => edge.mechanism === 'http');
    expect(http?.source.ref).toBe('newsletter service');
    expect(http?.target.ref).toBe('user-profile service');
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
