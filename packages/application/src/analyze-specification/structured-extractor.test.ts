import { describe, expect, it } from 'vitest';

import { structuredExtraction } from './structured-extractor.js';

// Item 1 of the trial follow-up: respect the specification's structure. Every case here is a
// failure observed in a real trial, written as an assertion.

const NUMBERED_SPEC = `# NDA signature notification

## Context

The buyer currently receives no notification when a seller requests an NDA signature.
This has been a support burden since March.

## Requirements

R1: \`deal-management\` must emit a \`notification.nda_signature_request\` event on request.
R2. The \`notification-service\` push route must project the event into a message.
R3) Locale files must carry a \`nda.signature_request.subject\` key for de and en.

## Non-goals

- Reworking the existing e-mail template engine.
- Adding SMS delivery.

## Constraints

- The event payload must stay backwards compatible.

## Implementation notes

Reuse \`MessageRenderer\` rather than writing a new one.
`;

describe('structuredExtraction — explicit numbered requirements', () => {
  const extraction = structuredExtraction(NUMBERED_SPEC);

  it('extracts exactly the three declared requirements', () => {
    expect(extraction.requirements).toHaveLength(3);
    expect(extraction.requirements.map((requirement) => requirement.label)).toEqual([
      'R1',
      'R2',
      'R3',
    ]);
  });

  it('marks them as author-labelled, not extractor prose', () => {
    expect(
      extraction.requirements.every((requirement) => requirement.origin === 'explicit-label'),
    ).toBe(true);
    expect(extraction.quality?.strategy).toBe('structured');
    expect(extraction.quality?.provisional).toBe(false);
    expect(extraction.quality?.warnings).toEqual([]);
  });

  it('keeps the requirement statement verbatim, without the label prefix', () => {
    expect(extraction.requirements[0]?.statement).toBe(
      '`deal-management` must emit a `notification.nda_signature_request` event on request.',
    );
  });

  it('never turns context prose into a requirement', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('support burden'))).toBe(false);
    const context = (extraction.notes ?? []).filter((note) => note.kind === 'context');
    expect(context.some((note) => note.statement.includes('support burden'))).toBe(true);
  });

  it('records non-goals as non-goals, never as requirements', () => {
    const nonGoals = (extraction.notes ?? []).filter((note) => note.kind === 'non-goal');
    expect(nonGoals.map((note) => note.statement)).toEqual([
      'Reworking the existing e-mail template engine.',
      'Adding SMS delivery.',
    ]);
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('SMS'))).toBe(false);
  });

  it('routes constraints and implementation notes to their own channels', () => {
    expect(extraction.constraints).toEqual(['The event payload must stay backwards compatible.']);
    const notes = (extraction.notes ?? []).filter((note) => note.kind === 'implementation-note');
    expect(notes[0]?.statement).toContain('MessageRenderer');
  });

  it('extracts dotted event names and snake_case keys as concepts', () => {
    expect(extraction.requirements[0]?.concepts).toContain('notification.nda_signature_request');
    expect(extraction.requirements[2]?.concepts).toContain('nda.signature_request.subject');
  });
});

describe('structuredExtraction — other structured shapes', () => {
  it('reads acceptance criteria as requirements', () => {
    const extraction = structuredExtraction(
      '# Feature\n\n## Acceptance criteria\n\n- The list excludes archived deals.\n- The count reflects the filter.\n',
    );
    expect(extraction.requirements).toHaveLength(2);
    expect(extraction.requirements[0]?.origin).toBe('acceptance-criterion');
  });

  it('reads task lists as requirements', () => {
    const extraction = structuredExtraction(
      '# Work\n\n## Tasks\n\n- [ ] Add the outbox record.\n- [x] Publish the topic.\n',
    );
    expect(extraction.requirements.map((requirement) => requirement.origin)).toEqual([
      'task-item',
      'task-item',
    ]);
  });

  it('reads a numbered list under a requirements heading', () => {
    const extraction = structuredExtraction(
      '# Change\n\n## Requirements\n\n1. The API must return an expiry date.\n2. The UI must show it.\n',
    );
    expect(extraction.requirements.map((requirement) => requirement.origin)).toEqual([
      'numbered-item',
      'numbered-item',
    ]);
    expect(extraction.requirements[0]?.label).toBe('1');
  });

  it('finds explicit labels even under an unrecognized heading', () => {
    const extraction = structuredExtraction(
      '# Spec\n\n## Rollout plan\n\nR4: The feature flag must default to off.\n\nSome unrelated prose about timing.\n',
    );
    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.label).toBe('R4');
    expect(extraction.quality?.strategy).toBe('structured');
  });

  it('inherits the requirements role into deeper subsections', () => {
    const extraction = structuredExtraction(
      '# Spec\n\n## Requirements\n\n### Backend\n\n- The service must retry twice.\n\n### Frontend\n\n- The banner must disappear.\n',
    );
    expect(extraction.requirements).toHaveLength(2);
    expect(extraction.requirements[1]?.heading).toBe('Frontend');
  });

  it('joins a wrapped list item instead of splitting it', () => {
    const extraction = structuredExtraction(
      '## Requirements\n\n- The renderer must interpolate the buyer name\n  into the subject line.\n',
    );
    expect(extraction.requirements).toHaveLength(1);
    expect(extraction.requirements[0]?.statement).toBe(
      'The renderer must interpolate the buyer name into the subject line.',
    );
  });

  it('ignores fenced code as requirement text', () => {
    const extraction = structuredExtraction(
      '## Requirements\n\n- The payload must match the schema.\n\n```json\n{ "a": 1 }\n```\n',
    );
    expect(extraction.requirements).toHaveLength(1);
  });
});

describe('structuredExtraction — formatting tolerance (field feedback)', () => {
  // A realistic engineering spec: bold pseudo-headings, • bullets, no R1/R2 numbering at all.
  const FIELD_SPEC = [
    '# Preflight rollout',
    '',
    '**Goals**',
    '',
    'Ship the new preflight check to all tenants.',
    '',
    '**Decisions**',
    '',
    '• Reuse `preflight-runner.ts` for the execution loop.',
    '• Keep `tenant-flags.yml` as the rollout switch.',
    '',
    '**Acceptance Criteria**',
    '',
    '• The check runs on every submission.',
    '• A failed check blocks the submission.',
    '',
  ].join('\n');
  const extraction = structuredExtraction(FIELD_SPEC);

  it('reads bold pseudo-headings with • bullets as structured acceptance criteria', () => {
    expect(extraction.requirements.map((requirement) => requirement.origin)).toEqual([
      'acceptance-criterion',
      'acceptance-criterion',
    ]);
    expect(extraction.quality?.strategy).toBe('structured');
    expect(extraction.quality?.provisional).toBe(false);
    expect(extraction.quality?.warnings).toEqual([]);
  });

  it('recognizes Goals and Decisions sections instead of dropping them', () => {
    expect(extraction.quality?.recognizedSections).toEqual([
      'Goals',
      'Decisions',
      'Acceptance Criteria',
    ]);
  });

  it('keeps decisions and goals as notes, never inflating the requirement list', () => {
    expect(extraction.requirements).toHaveLength(2);
    const notes = extraction.notes ?? [];
    expect(notes.some((note) => note.statement.includes('preflight-runner.ts'))).toBe(true);
    expect(notes.some((note) => note.statement.includes('Ship the new preflight check'))).toBe(
      true,
    );
  });

  it('reads a colon-terminated heading line as a section start', () => {
    const colonSpec = structuredExtraction(
      'Acceptance Criteria:\n\n- The export includes headers.\n',
    );
    expect(colonSpec.requirements[0]?.origin).toBe('acceptance-criterion');
    expect(colonSpec.quality?.provisional).toBe(false);
  });
});

describe('structuredExtraction — graduated prose extraction', () => {
  const extraction = structuredExtraction(
    '# Notes\n\nThe notification service should render the message. The buyer must see it in their inbox.\n\n## Out of scope\n\nRewriting the mailer.\n',
  );

  it('admits normative prose statements as prose-modal requirements with a confidence', () => {
    expect(extraction.requirements).toHaveLength(2);
    expect(
      extraction.requirements.every((requirement) => requirement.origin === 'prose-modal'),
    ).toBe(true);
    expect(
      extraction.requirements.every((requirement) => (requirement.extractionConfidence ?? 0) > 0),
    ).toBe(true);
  });

  it('reports prose-modal extraction without withholding readiness or demanding a reformat', () => {
    expect(extraction.quality?.strategy).toBe('prose-modal');
    expect(extraction.quality?.provisional).toBe(false);
    const warning = extraction.quality?.warnings[0] ?? '';
    expect(warning).toContain('PROSE EXTRACTION');
    expect(warning).not.toContain('re-submit');
    expect(warning).not.toContain('PROVISIONAL');
  });

  it('names the actually accepted shapes instead of demanding R1/R2 phrasing', () => {
    // The extractor accepts several structured shapes; the remediation text must not name only
    // the narrowest one (field feedback: "R1, R2, … or a numbered list" was misleading).
    const warning = extraction.quality?.warnings[0] ?? '';
    expect(warning).not.toContain('R1, R2');
    expect(warning).toContain('Acceptance Criteria');
    expect(warning).toContain('•');
    expect(warning).toContain('optional');
  });

  it('is NOT provisional for many modal statements — modal prose is a specification', () => {
    const modal = structuredExtraction(
      '# Plan\n\n' +
        [
          'The service must render messages.',
          'The buyer must see the message.',
          'The seller should be notified too.',
          'The audit log must record the send.',
          'The retry policy should back off.',
        ].join(' ') +
        '\n',
    );
    expect(modal.requirements.length).toBe(5);
    expect(modal.quality?.provisional).toBe(false);
    expect(modal.quality?.strategy).toBe('prose-modal');
  });

  it('stays provisional when the prose is mostly uncertain sentences', () => {
    const uncertain = structuredExtraction(
      '# Plan\n\n' +
        [
          'The service renders messages in one place.',
          'The buyer sees the message in the inbox view.',
          'The seller gets a notification path of some kind.',
          'The audit log keeps one entry per send there.',
          'The retry policy backs off between attempts always.',
        ].join(' ') +
        '\n',
    );
    expect(uncertain.requirements).toHaveLength(0);
    expect(uncertain.quality?.provisional).toBe(true);
    expect(uncertain.quality?.warnings[0]).toContain('PROVISIONAL');
    expect(uncertain.quality?.uncertainStatementCount).toBe(5);
    expect(uncertain.openQuestions.length).toBe(5);
  });

  it('still refuses to turn a non-goal into a requirement in graduated mode', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('Rewriting the mailer'))).toBe(false);
    expect((extraction.notes ?? []).some((note) => note.kind === 'non-goal')).toBe(true);
  });
});

describe('structuredExtraction — a normal design doc (field failure)', () => {
  // The document that triggered the direction change: ## Background prose, ## Goals prose,
  // ## Non-goals. It used to be sentence-split wholesale into ~20 "requirements", marked
  // PROVISIONAL, readiness withheld, and its author told to reformat and re-submit.
  const DESIGN_DOC = [
    '# Confidence rework',
    '',
    '## Background',
    '',
    'Path resolution today anchors spec paths at the workspace root. The `legacy-path-resolver`',
    'was originally built for single-repository workspaces. This has been a source of false',
    'positives because lexical matches outrank structural ones.',
    '',
    '## Goals',
    '',
    'The confidence engine must stop assigning high confidence to purely lexical matches.',
    'Structural evidence should outrank lexical evidence in every ranking. Ranking changes',
    'apply to the HTML export as well.',
    '',
    '## Non-goals',
    '',
    '- Reworking the persistence layer.',
    '',
  ].join('\n');
  const extraction = structuredExtraction(DESIGN_DOC);

  it('never turns background narration into requirements', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('anchors spec paths'))).toBe(false);
    expect(statements.some((statement) => statement.includes('originally built'))).toBe(false);
    expect(statements.some((statement) => statement.includes('false positives'))).toBe(false);
  });

  it('admits the modal Goals sentences as prose-modal requirements with confidence', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements).toContain(
      'The confidence engine must stop assigning high confidence to purely lexical matches.',
    );
    expect(statements).toContain(
      'Structural evidence should outrank lexical evidence in every ranking.',
    );
    expect(
      extraction.requirements.every((requirement) => requirement.origin === 'prose-modal'),
    ).toBe(true);
    expect(
      extraction.requirements.every((requirement) => (requirement.extractionConfidence ?? 0) > 0),
    ).toBe(true);
  });

  it('is not provisional and does not tell the author to reformat', () => {
    expect(extraction.quality?.provisional).toBe(false);
    expect(extraction.quality?.strategy).toBe('prose-modal');
    const warnings = (extraction.quality?.warnings ?? []).join(' ');
    expect(warnings).not.toContain('re-submit');
    expect(warnings).not.toContain('PROVISIONAL');
  });

  it('routes the uncertain Goals sentence to an open question instead of inventing a requirement', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('apply to the HTML export'))).toBe(
      false,
    );
    expect(
      extraction.openQuestions.some((question) =>
        question.question.includes('apply to the HTML export'),
      ),
    ).toBe(true);
    expect(extraction.quality?.uncertainStatementCount).toBe(1);
    const ambiguous = (extraction.notes ?? []).filter((note) => note.kind === 'ambiguous');
    expect(ambiguous.some((note) => note.statement.includes('apply to the HTML export'))).toBe(
      true,
    );
  });

  it('keeps concepts from rejected background prose off every requirement', () => {
    const concepts = extraction.requirements.flatMap((requirement) => requirement.concepts);
    expect(concepts).not.toContain('legacy-path-resolver');
  });

  it('keeps the non-goal out of the requirements', () => {
    const statements = extraction.requirements.map((requirement) => requirement.statement);
    expect(statements.some((statement) => statement.includes('persistence layer'))).toBe(false);
  });
});

describe('structuredExtraction — ambiguity', () => {
  it('records a vague statement as ambiguous alongside its requirement', () => {
    const extraction = structuredExtraction(
      '## Requirements\n\n- It has to be better.\n- `DealService` must filter expired deals.\n',
    );
    const ambiguous = (extraction.notes ?? []).filter((note) => note.kind === 'ambiguous');
    expect(ambiguous.map((note) => note.statement)).toEqual(['It has to be better.']);
  });
});
