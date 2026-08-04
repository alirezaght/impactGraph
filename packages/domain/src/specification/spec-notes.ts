import { validationIssue } from '../errors/validation.js';
import { blankIdIssue } from '../provenance/evidence.js';

import { stableContentId } from './requirement.js';

import type { TextRange } from './requirement.js';
import type { ValidationIssue } from '../errors/validation.js';

/**
 * Specification prose that is NOT a requirement (PRD §11.1, trial finding: "Non-goals and context
 * were treated as requirements").
 *
 * A specification says several kinds of thing, and only one of them predicts a change. Background
 * explains why the work exists; a non-goal states what must NOT happen; an implementation note
 * suggests how. Feeding any of them into concept matching produces impacts that nothing in the
 * specification actually asked for, so they are kept as first-class notes with their kind attached
 * rather than folded into `requirements`.
 */
export const SPEC_NOTE_KINDS = [
  'context',
  'background',
  /** An explicit exclusion. Used as a negative signal by the impact engine, never a positive one. */
  'non-goal',
  'implementation-note',
  /**
   * A statement that reads like a requirement but is too vague to anchor one — recorded so the
   * clarification engine can ask, instead of silently becoming an impact or silently vanishing.
   */
  'ambiguous',
] as const;

export type SpecNoteKind = (typeof SPEC_NOTE_KINDS)[number];

export interface SpecNote {
  readonly id: string;
  readonly kind: SpecNoteKind;
  readonly statement: string;
  /** Heading the statement was found under, verbatim — the audit trail for the classification. */
  readonly heading?: string;
  readonly sourceRange?: TextRange;
}

export const specNoteId = (kind: SpecNoteKind, statement: string): string =>
  stableContentId(`note-${kind}`, statement);

export const specNoteIssues = (note: SpecNote, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [...blankIdIssue(note.id, `${path}.id`)];
  if (note.statement.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.statement`, 'statement must not be blank'));
  }
  if (!(SPEC_NOTE_KINDS as readonly string[]).includes(note.kind)) {
    issues.push(
      validationIssue('invalid-type', `${path}.kind`, `unknown note kind '${note.kind}'`),
    );
  }
  return issues;
};

/** Non-goals, in specification order — the exclusion set the impact engine reads. */
export const nonGoalsOf = (notes: readonly SpecNote[] | undefined): readonly SpecNote[] =>
  (notes ?? []).filter((note) => note.kind === 'non-goal');
