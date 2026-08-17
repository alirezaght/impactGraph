import { describe, expect, it } from 'vitest';

import { toolResultText } from './summary-text.js';

describe('toolResultText (ADR-0022)', () => {
  it('renders a review verdict instead of the whole document', () => {
    const payload = {
      verdict: {
        status: 'PASS',
        headline: 'Implementation review: PASS — 0 violations, 0 missing requirements.',
        counts: { matched: 9, missing: 0, reuseConfirmed: 2 },
        decidingFindings: [],
      },
      findings: Array.from({ length: 137 }, (_, index) => ({
        category: 'unexpected',
        nodeId: `file:src/generated/module-${String(index)}.ts`,
        explanation: `'src/generated/module-${String(index)}.ts' was modified but is not part of the approved analysis.`,
      })),
    };

    const text = toolResultText(payload);

    expect(text).toContain('Implementation review: PASS');
    expect(text).toContain('matched 9');
    expect(text).toContain('Full detail is in structuredContent.');
    expect(text.length).toBeLessThan(2000);
  });

  it('names the findings that decided a failing verdict', () => {
    const text = toolResultText({
      verdict: {
        status: 'NEEDS_ATTENTION',
        headline: 'Implementation review: NEEDS ATTENTION — 1 missing requirement.',
        counts: { missing: 1 },
        decidingFindings: [
          { category: 'missing', nodeId: 'sym:policy', explanation: 'AlertPolicy did not change.' },
        ],
      },
    });

    expect(text).toContain('[missing] AlertPolicy did not change.');
  });

  it('renders the plan assessment for an analysis payload', () => {
    const text = toolResultText({
      planAssessment: { feasibility: 'READY_WITH_WARNINGS', decision: 'Two risks to verify.' },
      headline: 'READY WITH 2 RISKS — 14 change surfaces on strong evidence.',
    });

    expect(text).toContain('READY_WITH_WARNINGS');
    expect(text).toContain('14 change surfaces');
  });

  it('falls back to compact JSON when the payload carries no verdict', () => {
    const text = toolResultText({ schemaVersion: 1, command: 'status' });

    expect(text).toBe('{"schemaVersion":1,"command":"status"}');
  });
});
