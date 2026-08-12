import { describe, expect, it } from 'vitest';

import { cappedSeverity, canBlock } from './constraint-vocabulary.js';
import { createRepositoryConstraint, isExempt } from './repository-constraint.js';

import type { RepositoryConstraint } from './repository-constraint.js';

const base = (overrides: Partial<RepositoryConstraint> = {}): RepositoryConstraint => ({
  id: 'constraint-peer-http',
  name: 'service peer HTTP forbidden',
  kind: 'forbidden-runtime-call',
  severity: 'blocking',
  extraction: 'recognized',
  scope: { pathGlobs: ['services/**'] },
  rule: {
    relation: 'FORBIDS',
    subjectPattern: 'http(s)://<peer-service>',
    statement: 'services must not call peer services over HTTP',
  },
  exemptions: [
    {
      id: 'exempt-send-job',
      subject: 'services/newsletter-service/jobs/send',
      source: { kind: 'file', filePath: 'ci/scripts/peer-http-allowlist.txt' },
    },
  ],
  source: { kind: 'file', filePath: 'ci/scripts/check-service-peer-http.py' },
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-12T00:00:00.000Z',
  ...overrides,
});

describe('createRepositoryConstraint', () => {
  it('accepts a recognized blocking constraint', () => {
    const result = createRepositoryConstraint(base());
    expect(result.ok).toBe(true);
  });

  it('rejects a blocking constraint whose rule was only proposed by a model', () => {
    const result = createRepositoryConstraint(base({ extraction: 'ai-proposed' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]?.message).toContain('not available');
    }
  });

  it('rejects a blocking constraint whose guard could not be parsed', () => {
    const result = createRepositoryConstraint(
      base({ extraction: 'opaque', kind: 'opaque-check', notExtractedReason: 'shell script' }),
    );
    expect(result.ok).toBe(false);
  });

  it('allows a human-declared constraint to block', () => {
    const result = createRepositoryConstraint(base({ extraction: 'declared' }));
    expect(result.ok).toBe(true);
  });

  it('requires an opaque check to state why its rule was not extracted', () => {
    const result = createRepositoryConstraint(
      base({ kind: 'opaque-check', extraction: 'opaque', severity: 'warning' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.some((issue) => issue.path === 'notExtractedReason')).toBe(true);
    }
  });

  it('rejects a constraint with no rule statement', () => {
    const result = createRepositoryConstraint(
      base({ rule: { relation: 'FORBIDS', statement: '  ' } }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('isExempt', () => {
  it('recognises an allowlisted subject', () => {
    const result = createRepositoryConstraint(base());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isExempt(result.value, 'services/newsletter-service/jobs/send')).toBe(true);
      expect(isExempt(result.value, 'services/newsletter-service/api/routes')).toBe(false);
    }
  });
});

describe('extraction authority', () => {
  it('only recognized and declared extractions may block', () => {
    expect(canBlock('recognized')).toBe(true);
    expect(canBlock('declared')).toBe(true);
    expect(canBlock('ai-proposed')).toBe(false);
    expect(canBlock('opaque')).toBe(false);
  });

  it('caps a proposed blocking severity down to warning for weak extractions', () => {
    expect(cappedSeverity('blocking', 'ai-proposed')).toBe('warning');
    expect(cappedSeverity('blocking', 'recognized')).toBe('blocking');
    expect(cappedSeverity('advisory', 'opaque')).toBe('advisory');
  });
});
