import { describe, expect, it } from 'vitest';

import { buildIssueItems } from './issues-items.js';

describe('issues view mapping (Stories 7.2/8.3/14.5)', () => {
  it('groups drift, suggestions, proposals, and warnings into labeled sections', () => {
    const roots = buildIssueItems({
      drift: {
        needsReview: [
          {
            kind: 'stale-context',
            subject: 'legacy-billing',
            detail: "context path 'src/billing/**' matches no indexed files — kept for review",
          },
        ],
        suggestions: [
          {
            kind: 'uncovered-package',
            subject: 'ts-basic',
            detail: 'not assigned to any context',
            suggestedOperation: {
              kind: 'add-context',
              name: 'ts-basic',
              paths: ['**'],
              reason: 'r',
            },
          },
        ],
      },
      proposals: [
        {
          schemaVersion: 1,
          timestamp: '2026-08-01T10:00:00.000Z',
          kind: 'rejected-impact',
          detail: "impact on 'sym:billing' for req-1 rejected: shared type only",
        },
      ],
      indexWarnings: ['src/huge.ts: oversized'],
    });
    expect(roots).toHaveLength(4);
    const firstChildren = roots.map((section) => section.children[0]);
    expect(firstChildren[0]?.label).toBe('[stale-context] legacy-billing');
    expect(firstChildren[0]?.description).toContain('kept for review');
    expect(firstChildren[1]?.kind).toBe('suggestion');
    expect(firstChildren[2]?.description).toContain('shared type only');
    expect(firstChildren[3]?.label).toContain('oversized');
  });

  it('empty inputs render explanatory placeholders, never blank sections', () => {
    const roots = buildIssueItems({ drift: undefined, proposals: [], indexWarnings: [] });
    for (const section of roots) {
      expect(section.children).toHaveLength(1);
      expect(section.children[0]?.kind).toBe('empty');
    }
    expect(roots[0]?.children[0]?.label).toContain('matches the current graph');
  });
});
