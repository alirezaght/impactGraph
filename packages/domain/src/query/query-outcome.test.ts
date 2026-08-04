import { describe, expect, it } from 'vitest';

import {
  describeOutcome,
  failedOutcome,
  notRunOutcome,
  queryOutcome,
  queryOutcomeIssues,
} from './query-outcome.js';

// Item 11: "no callers" and "I did not look" must not be the same output.

describe('queryOutcome', () => {
  it('reports an empty result as completed-empty, never completed', () => {
    expect(queryOutcome({ scope: 'the indexed graph', resultCount: 0 }).status).toBe(
      'completed-empty',
    );
  });

  it('reports a non-empty result as completed', () => {
    expect(queryOutcome({ scope: 'the indexed graph', resultCount: 3 }).status).toBe('completed');
  });

  it('reports truncation as partial with its reason', () => {
    const outcome = queryOutcome({
      scope: 'the indexed graph',
      resultCount: 25,
      partialReason: 'result limit reached',
    });
    expect(outcome.status).toBe('partial');
    expect(outcome.reason).toBe('result limit reached');
  });

  it('carries limitations so an empty result cannot be over-read', () => {
    const outcome = queryOutcome({
      scope: 'the indexed graph of this repository',
      resultCount: 0,
      limitations: ['External repositories were not analyzed.'],
    });
    expect(outcome.limitations).toContain('External repositories were not analyzed.');
  });
});

describe('queryOutcomeIssues', () => {
  it('rejects an unscoped outcome', () => {
    const issues = queryOutcomeIssues(
      { status: 'completed-empty', scope: '  ', limitations: [], resultCount: 0 },
      'outcome',
    );
    expect(issues.map((issue) => issue.code)).toContain('blank-field');
  });

  it('rejects completed with zero results', () => {
    const issues = queryOutcomeIssues(
      { status: 'completed', scope: 'the graph', limitations: [], resultCount: 0 },
      'outcome',
    );
    expect(issues[0]?.message).toContain("'completed-empty'");
  });

  it('requires a reason for partial and failed', () => {
    expect(
      queryOutcomeIssues(
        { status: 'partial', scope: 'the graph', limitations: [], resultCount: 1 },
        'outcome',
      ),
    ).toHaveLength(1);
    expect(
      queryOutcomeIssues(
        { status: 'failed', scope: 'the graph', limitations: [], resultCount: 0 },
        'outcome',
      ),
    ).toHaveLength(1);
  });

  it('accepts a well-formed outcome', () => {
    expect(
      queryOutcomeIssues(queryOutcome({ scope: 'the graph', resultCount: 2 }), 'outcome'),
    ).toEqual([]);
  });
});

describe('describeOutcome', () => {
  it('phrases an empty result as scoped absence, not as a property of the subject', () => {
    const sentence = describeOutcome(
      queryOutcome({
        scope: 'the indexed repository',
        resultCount: 0,
        limitations: ['External repositories were not analyzed.'],
      }),
      'inbound callers',
    );
    expect(sentence).toBe(
      'No inbound callers were found in the indexed repository. External repositories were not analyzed.',
    );
    expect(sentence).not.toContain('has no');
  });

  it('says outright that a query was not run', () => {
    expect(
      describeOutcome(
        notRunOutcome('the indexed repository', 'Caller analysis was not requested.'),
        'callers',
      ),
    ).toContain('No callers query was run');
  });

  it('says outright that a query failed', () => {
    expect(describeOutcome(failedOutcome('the graph', 'index unreadable'), 'callers')).toContain(
      'failed (index unreadable)',
    );
  });
});
