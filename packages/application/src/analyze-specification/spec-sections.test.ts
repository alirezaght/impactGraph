import { describe, expect, it } from 'vitest';

import { roleForHeading, splitSections } from './spec-sections.js';

// Field feedback: realistic engineering specs were penalized for formatting. A spec with clearly
// structured "Acceptance Criteria" and "Decisions" sections contributed nothing because the
// headings were bold pseudo-headings and the roles were missing from the vocabulary.

describe('roleForHeading — decisions and goals vocabulary', () => {
  it.each(['Decisions', 'Technical decisions', 'Design', 'Approach', 'Architecture notes'])(
    "maps '%s' to decisions",
    (heading) => {
      expect(roleForHeading(heading)).toBe('decisions');
    },
  );

  it.each(['Goals', 'Objectives', 'Scope', 'In scope'])("maps '%s' to goals", (heading) => {
    expect(roleForHeading(heading)).toBe('goals');
  });

  it('keeps the more specific existing roles ahead of the new ones', () => {
    expect(roleForHeading('Out of scope')).toBe('non-goals');
    expect(roleForHeading('Non-goals')).toBe('non-goals');
    expect(roleForHeading('Design constraints')).toBe('constraints');
    expect(roleForHeading('Non-functional requirements')).toBe('requirements');
  });
});

describe('splitSections — bold pseudo-headings', () => {
  it('treats a standalone bold phrase as a section start', () => {
    const sections = splitSections('**Acceptance Criteria**\n\n- The export includes headers.\n');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Acceptance Criteria');
    expect(sections[0]?.role).toBe('acceptance-criteria');
    expect(sections[0]?.lines.join('\n')).toContain('The export includes headers.');
  });

  it('treats a standalone italic phrase as a section start', () => {
    const sections = splitSections('_Decisions_\n\n- Keep the v1 API.\n');
    expect(sections[0]?.heading).toBe('Decisions');
    expect(sections[0]?.role).toBe('decisions');
  });

  it('accepts a trailing colon inside the bold phrase', () => {
    const sections = splitSections('**Acceptance Criteria:**\n\n- Works offline.\n');
    expect(sections[0]?.heading).toBe('Acceptance Criteria');
    expect(sections[0]?.role).toBe('acceptance-criteria');
  });

  it('does not treat bold emphasis inside a paragraph as a heading', () => {
    const sections = splitSections(
      '## Context\n\nWe agreed **strongly** on this and it matters a lot.\n',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Context');
  });

  it('does not treat a bold full sentence as a heading', () => {
    const sections = splitSections('## Context\n\n**All inputs must be validated.**\n');
    expect(sections).toHaveLength(1);
  });

  it('lets an unrecognized bold pseudo-heading inherit the enclosing recognized role', () => {
    const sections = splitSections(
      '## Requirements\n\n**Backend**\n\n- The service must retry twice.\n',
    );
    expect(sections.map((section) => section.role)).toEqual(['requirements', 'requirements']);
    expect(sections[1]?.heading).toBe('Backend');
  });
});

describe('splitSections — colon-terminated headings', () => {
  it('treats a short recognized line ending with a colon as a section start', () => {
    const sections = splitSections('Acceptance Criteria:\n\n- The count reflects the filter.\n');
    expect(sections[0]?.heading).toBe('Acceptance Criteria');
    expect(sections[0]?.role).toBe('acceptance-criteria');
  });

  it('ignores a colon-terminated line whose text matches no heading rule', () => {
    const sections = splitSections('## Context\n\nRandom label:\n\nmore prose here\n');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Context');
  });

  it('ignores a list item that happens to end with a colon', () => {
    const sections = splitSections('## Requirements\n\n- Acceptance criteria:\n  nested detail\n');
    expect(sections).toHaveLength(1);
  });

  it('keeps ATX and setext precedence over pseudo-headings', () => {
    const sections = splitSections('Requirements\n=====\n\n- The API must paginate.\n');
    expect(sections[0]?.level).toBe(1);
    expect(sections[0]?.role).toBe('requirements');
  });
});
