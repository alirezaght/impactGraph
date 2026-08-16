import { describe, expect, it } from 'vitest';

import { extractConstraints } from './extract-constraints.js';
import { fromDeclaredEntries } from './recognizers/declared-manifest.js';
import { looksLikeGuardPath } from './types.js';

import type { ExtractConstraintsRequest } from './extract-constraints.js';
import type { GuardFile } from './types.js';

/**
 * The peer-HTTP guard, in the shape the real one takes: a walked directory, a compiled pattern,
 * an allowlist, and a non-zero exit.
 */
const PEER_HTTP_GUARD = `#!/usr/bin/env python3
"""Fail if a service calls a peer service over HTTP."""
import re, sys
from pathlib import Path

SERVICE_DIRS = "services"
ALLOWLIST = [
    "services/newsletter-service/jobs/send.py",
]
PEER_HTTP = re.compile(r"https?://[a-z0-9-]+-service")

def main():
    for path in Path(SERVICE_DIRS).rglob("*.py"):
        if str(path) in ALLOWLIST:
            continue
        if PEER_HTTP.search(path.read_text()):
            print(f"peer HTTP call in {path}")
            sys.exit(1)
`;

const request = (files: readonly GuardFile[]): ExtractConstraintsRequest => ({
  files,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-12T00:00:00.000Z',
  nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 60)}`,
  nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 60)}`,
});

describe('extractConstraints — guard scripts', () => {
  it('reads a peer-HTTP guard as a blocking forbidden-runtime-call constraint', () => {
    const result = extractConstraints(
      request([{ path: 'ci/scripts/check-service-peer-http.py', content: PEER_HTTP_GUARD }]),
    );
    const constraint = result.constraints.find((entry) => entry.kind === 'forbidden-runtime-call');
    expect(constraint).toBeDefined();
    expect(constraint?.severity).toBe('blocking');
    expect(constraint?.extraction).toBe('recognized');
    expect(constraint?.scope.pathGlobs).toEqual(['services/**']);
    expect(constraint?.source.filePath).toBe('ci/scripts/check-service-peer-http.py');
    expect(result.rejected).toEqual([]);
  });

  it('carries the allowlist across as exemptions', () => {
    const result = extractConstraints(
      request([{ path: 'ci/scripts/check-service-peer-http.py', content: PEER_HTTP_GUARD }]),
    );
    const constraint = result.constraints.find((entry) => entry.kind === 'forbidden-runtime-call');
    expect(constraint?.exemptions.map((entry) => entry.subject)).toEqual([
      'services/newsletter-service/jobs/send.py',
    ]);
  });

  it('downgrades a guard that only prints to a warning', () => {
    const advisory = PEER_HTTP_GUARD.replace('sys.exit(1)', 'pass');
    const result = extractConstraints(
      request([{ path: 'ci/scripts/check-service-peer-http.py', content: advisory }]),
    );
    expect(
      result.constraints.find((entry) => entry.kind === 'forbidden-runtime-call')?.severity,
    ).toBe('warning');
  });

  it('indexes an unreadable guard as opaque rather than reporting nothing', () => {
    const result = extractConstraints(
      request([
        { path: 'ci/scripts/check-something.sh', content: '#!/bin/sh\nmake verify || exit 1\n' },
      ]),
    );
    const constraint = result.constraints[0];
    expect(constraint?.kind).toBe('opaque-check');
    expect(constraint?.extraction).toBe('opaque');
    expect(constraint?.severity).toBe('warning');
    expect(constraint?.notExtractedReason).toContain('not match a known shape');
    expect(result.opaqueGuardPaths).toEqual(['ci/scripts/check-something.sh']);
  });

  it('refuses to build exemptions from an allowlist it could not fully read', () => {
    const computed = PEER_HTTP_GUARD.replace(
      '"services/newsletter-service/jobs/send.py",',
      '"services/a.py", load_extra_allowlist(),',
    );
    const result = extractConstraints(
      request([{ path: 'ci/scripts/check-service-peer-http.py', content: computed }]),
    );
    const constraint = result.constraints.find((entry) => entry.kind === 'forbidden-runtime-call');
    expect(constraint?.exemptions).toEqual([]);
  });
});

describe('extractConstraints — lint boundaries', () => {
  const ESLINT = `export default [
    { rules: { 'boundaries/element-types': ['error', { rules: [
      { from: 'domain', allow: [] },
      { from: 'application', allow: ['domain'] },
    ] }] } },
    { files: ['packages/domain/**'], rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'node:fs' }, { name: 'vscode' }] }] } },
  ];`;

  it('reads an element-type allow-list as an ONLY_ALLOWED_TO boundary restriction', () => {
    const result = extractConstraints(request([{ path: 'eslint.config.mjs', content: ESLINT }]));
    const boundary = result.constraints.find(
      (entry) => entry.scope.roles?.includes('application') === true,
    );
    expect(boundary?.kind).toBe('boundary-restriction');
    expect(boundary?.rule.relation).toBe('ONLY_ALLOWED_TO');
    expect(boundary?.rule.targetScope?.roles).toEqual(['domain']);
    expect(boundary?.severity).toBe('blocking');
  });

  it('reads a restricted-import zone as a forbidden dependency scoped to its glob', () => {
    const result = extractConstraints(request([{ path: 'eslint.config.mjs', content: ESLINT }]));
    const forbidden = result.constraints.find((entry) => entry.kind === 'forbidden-dependency');
    expect(forbidden?.scope.pathGlobs).toEqual(['packages/domain/**']);
    expect(forbidden?.rule.subjectPattern).toContain('node:fs');
  });

  it('scopes each rule by the element PATTERNS and synthesizes default-disallow rules', () => {
    // The real config declares elements with patterns and `default: 'disallow'` — an element with
    // no `from` rule (domain) is the strictest rule of all, and dropping it made the one layering
    // rule the architecture is named after invisible to the constraint checker.
    const config = `export default [{
      settings: { 'boundaries/elements': [
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'application', pattern: 'packages/application' },
      ] },
      rules: { 'boundaries/element-types': ['error', { default: 'disallow', rules: [
        { from: 'application', allow: ['domain'] },
      ] }] },
    }];`;
    const result = extractConstraints(request([{ path: 'eslint.config.mjs', content: config }]));
    const application = result.constraints.find(
      (entry) => entry.scope.roles?.includes('application') === true,
    );
    expect(application?.scope.pathGlobs).toEqual(['packages/application/**']);
    expect(application?.rule.targetScope?.pathGlobs).toEqual(['packages/domain/**']);
    const domain = result.constraints.find(
      (entry) => entry.scope.roles?.includes('domain') === true,
    );
    expect(domain?.kind).toBe('boundary-restriction');
    expect(domain?.scope.pathGlobs).toEqual(['packages/domain/**']);
    expect(domain?.rule.targetScope?.roles).toEqual([]);
    expect(domain?.rule.statement).toContain('nothing');
  });
});

describe('extractConstraints — CI enforcement', () => {
  it('records which guards CI actually runs', () => {
    const workflow = `jobs:
  quality:
    steps:
      - run: pnpm quality:gates
      - run: python3 ci/scripts/check-service-peer-http.py
`;
    const result = extractConstraints(
      request([{ path: '.github/workflows/ci.yml', content: workflow }]),
    );
    const enforced = result.constraints.filter((entry) => entry.kind === 'must-pass-check');
    expect(enforced.length).toBeGreaterThanOrEqual(2);
    expect(
      enforced.some((entry) => entry.name.includes('ci/scripts/check-service-peer-http.py')),
    ).toBe(true);
  });
});

describe('looksLikeGuardPath — guard discovery stays out of product source and test material', () => {
  it.each([
    'ci/scripts/check-service-peer-http.py',
    'scripts/quality/secret-scan.ts',
    'scripts/quality/effective-loc/src/cli.ts',
    'check-links.py',
    'tools/checks/verify-schema.sh',
  ])('treats %s as a guard candidate', (path) => {
    expect(looksLikeGuardPath(path)).toBe(true);
  });

  it.each([
    // Guard-shaped NAMES inside product source trees are application code, not repository guards.
    'packages/application/src/preflight/check-assumptions.ts',
    'packages/application/src/review-implementation/check-plan-contract.ts',
    // Fixtures and tests are material FOR checks, never checks — whatever directory holds them.
    'scripts/quality/effective-loc/fixtures/over-limit.ts',
    'scripts/quality/effective-loc/tests/analyzer.test.ts',
    'ci/scripts/__tests__/check-service-peer-http.test.py',
    'scripts/quality/secret-scan.spec.ts',
  ])('never treats %s as a guard candidate', (path) => {
    expect(looksLikeGuardPath(path)).toBe(false);
  });
});

describe('extractConstraints — declared manifest', () => {
  it('gives a human-declared constraint full blocking authority', () => {
    const declared = fromDeclaredEntries([
      {
        id: 'no-cross-context-db',
        name: 'no cross-context database access',
        kind: 'forbidden-dependency',
        severity: 'blocking',
        relation: 'FORBIDS',
        statement: 'a service must not read another context’s tables directly',
        appliesTo: ['services/**'],
        forbids: 'other_context_schema',
        exempt: ['services/reporting/**'],
      },
    ]);
    const result = extractConstraints({ ...request([]), declared });
    const constraint = result.constraints[0];
    expect(constraint?.extraction).toBe('declared');
    expect(constraint?.severity).toBe('blocking');
    expect(constraint?.provenance).toBe('human-confirmed');
    expect(constraint?.exemptions[0]?.subject).toBe('services/reporting/**');
  });
});
