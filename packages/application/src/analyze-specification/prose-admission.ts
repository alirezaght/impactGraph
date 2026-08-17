import { boundaryQuestionFor, readGuard } from './no-change-language.js';
import { classifyType, conceptsOf, priorityOf, proseStatements } from './statement-analysis.js';

import type {
  ExtractedNoteDraft,
  ExtractedQuestionDraft,
  ExtractedRequirementDraft,
} from './extraction-types.js';
import type { SectionRole, SpecSection } from './spec-sections.js';
import type { RequirementOrigin } from '@impactgraph/domain';

/**
 * The per-statement requirement classifier (ratified direction change).
 *
 * The rule the all-or-nothing fallback broke: a design doc written in prose is still a
 * specification, and each of its sentences says a DIFFERENT kind of thing. "The engine must stop
 * assigning high confidence" is a requirement; "Path resolution today anchors spec paths at the
 * workspace root" describes the present; "Ranking changes apply to the export as well" could be
 * either. The classifier admits the first, keeps the second as context, and EXPOSES the third as
 * an open question instead of inventing a requirement out of it. Deterministic, pure, explainable.
 */

export type ProseStatementClass =
  | 'requirement'
  /** A regression boundary with a surface to anchor on — a requirement pointing the other way. */
  | 'preservation'
  /** A boundary around nothing nameable — a question, never an invented guard. */
  | 'vague-preservation'
  | 'uncertain'
  | 'non-requirement';

/** Normative modality — the author committing the system to behavior (RFC-2119 vocabulary). */
const STRONG_MODAL =
  /\b(must|shall|should|needs?\s+to|(?:is|are)\s+required\s+to|ha(?:s|ve)\s+to)\b/i;

/** Future commitment — weaker than must/should: it also narrates ("this doc will describe"). */
const WILL_MODAL = /\bwill\b/i;

/** Imperative head verbs — a sentence that opens with one is a directive. */
const IMPERATIVE_HEADS = new Set([
  ...['add', 'implement', 'change', 'rename', 'remove', 'support', 'cap', 'resolve', 'emit'],
  ...['return', 'report', 'create', 'introduce', 'expose', 'update', 'delete', 'replace'],
  ...['extend', 'migrate', 'move', 'split', 'extract', 'validate', 'reject', 'allow', 'block'],
  ...['log', 'record', 'store', 'persist', 'ensure', 'prevent', 'stop', 'wire', 'surface'],
]);

/** Present-state narration — the sentence describes what IS, not what must become. */
const NARRATION =
  /\b(currently|today|previously|historically|so\s+far|until\s+now|at\s+the\s+moment|right\s+now|in\s+the\s+past|used\s+to)\b/i;

/** Rationale and example markers — the sentence explains WHY, it does not demand. */
const RATIONALE =
  /\b(because|since|as\s+a\s+result|therefore|for\s+example|for\s+instance)\b|\be\.g\.|\bi\.e\./i;

/** Past-tense narration of how the problem arose. */
const PAST_NARRATION =
  /\b(was|were|had\s+been|has\s+been|have\s+been|introduced|caused|led\s+to|resulted\s+in)\b/i;

/** The document talking about itself is never a requirement on the system. */
const META_DOCUMENT =
  /\b(this\s+(document|doc|spec|specification|section|page)|the\s+following\s+sections?)\b/i;

const hasImperativeHead = (statement: string): boolean => {
  const head = /^[*_`"'([]*([A-Za-z]+)/.exec(statement)?.[1]?.toLowerCase() ?? '';
  return IMPERATIVE_HEADS.has(head);
};

const isDemoted = (statement: string): boolean =>
  NARRATION.test(statement) ||
  RATIONALE.test(statement) ||
  PAST_NARRATION.test(statement) ||
  META_DOCUMENT.test(statement);

/**
 * Rule order is the semantics: a question is decided first, then NEGATED PRESERVATION, then a
 * strongly modal sentence; an imperative opening decides next (narration rarely opens with a bare
 * verb); only then do the demotion markers apply, so "must … because …" stays a requirement while
 * "will … for example …" does not. What remains — plain declaratives — is UNCERTAIN, never
 * silently a requirement.
 *
 * The preservation branch MUST precede the modal branch. "The send job must not change behavior"
 * contains "must", so the positive branch used to admit it as a prediction that the send job
 * changes — the exact inverse of the sentence. And "Existing lookup behaviour remains unchanged"
 * carries no modal at all, so it fell through to `uncertain` and became homework instead of the
 * requirement it is.
 */
export const classifyStatement = (statement: string): ProseStatementClass => {
  const text = statement.trim();
  if (text.endsWith('?')) {
    return 'non-requirement';
  }
  const guard = readGuard(text);
  if (guard !== undefined) {
    return guard.kind === 'guard' ? 'preservation' : 'vague-preservation';
  }
  if (STRONG_MODAL.test(text)) {
    return 'requirement';
  }
  if (hasImperativeHead(text)) {
    return 'requirement';
  }
  if (isDemoted(text)) {
    return 'non-requirement';
  }
  if (WILL_MODAL.test(text)) {
    return 'requirement';
  }
  return 'uncertain';
};

/** Deterministic admission confidence, derived from WHICH signal admitted the statement. */
export const admissionConfidence = (statement: string): number => {
  // A guard clause is the least ambiguous thing a specification writes: "must not change" cannot
  // be read as narration or rationale, so its admission is at least as certain as a modal's.
  if (readGuard(statement)?.kind === 'guard') {
    return 0.8;
  }
  if (STRONG_MODAL.test(statement)) {
    return 0.8;
  }
  if (hasImperativeHead(statement)) {
    return 0.65;
  }
  return 0.55; // "will" — a commitment, but the weakest one
};

/** Sections that must never contribute positive requirements, in any mode. */
const EXCLUDED_ROLES: readonly SectionRole[] = ['non-goals', 'open-questions', 'constraints'];

/**
 * Background/context and advisory sections face a stricter bar: only strongly modal statements
 * are admitted, and nothing there becomes an open question — narrating the problem must not
 * generate homework.
 */
const STRICT_ROLES: readonly SectionRole[] = ['context', 'implementation-notes', 'decisions'];

export interface ProseAdmission {
  readonly requirements: readonly ExtractedRequirementDraft[];
  /** Ambiguity notes for uncertain statements, plus context notes for rejected unknown-role prose. */
  readonly notes: readonly ExtractedNoteDraft[];
  readonly questions: readonly ExtractedQuestionDraft[];
  readonly uncertainCount: number;
}

const PROSE_MODAL_ORIGIN: RequirementOrigin = 'prose-modal';
const EXCERPT_LIMIT = 200;

const excerpt = (statement: string): string =>
  statement.length <= EXCERPT_LIMIT ? statement : `${statement.slice(0, EXCERPT_LIMIT - 1)}…`;

const toDraft = (
  statement: string,
  heading: string,
  intent: 'change' | 'preserve' = 'change',
): ExtractedRequirementDraft => {
  const priority = priorityOf(statement);
  return {
    ...(intent === 'preserve' ? { intent } : {}),
    statement,
    type: classifyType(statement),
    // Concepts are mined ONLY from admitted requirements — rejected prose must not flood
    // impact analysis with candidates nothing in the specification asked about.
    concepts: conceptsOf(statement),
    actors: [],
    ...(priority === undefined ? {} : { priority }),
    sourceExcerpt: statement,
    origin: PROSE_MODAL_ORIGIN,
    extractionConfidence: admissionConfidence(statement),
    ...(heading.length === 0 ? {} : { heading }),
  };
};

const questionFor = (statement: string, heading: string): ExtractedQuestionDraft => ({
  question: `Is this a requirement or context? "${excerpt(statement)}"${heading.length === 0 ? '' : ` (under '${heading}')`}`,
  reason:
    'The sentence is neither clearly normative (must/should/shall) nor clearly descriptive, ' +
    'so the extractor did not admit it as a requirement.',
  severity: 'minor',
  affectedRequirementStatements: [],
});

interface Sink {
  readonly requirements: ExtractedRequirementDraft[];
  readonly notes: ExtractedNoteDraft[];
  readonly questions: ExtractedQuestionDraft[];
  uncertainCount: number;
}

/**
 * The strict bar: only strongly modal statements are admitted, nothing becomes a question. A guard
 * clears it when it carries a modal ("must remain unchanged"), which keeps a boundary stated inside
 * a Decisions section, while "lookup behaviour remains unchanged" in a Background section stays
 * what it reads as there — narration of the present.
 */
const strictVerdict = (statement: string): ProseStatementClass => {
  const verdict = classifyStatement(statement);
  if (!STRONG_MODAL.test(statement)) {
    return 'non-requirement';
  }
  return verdict === 'requirement' || verdict === 'preservation' ? verdict : 'non-requirement';
};

const ambiguousNote = (statement: string, heading: string): ExtractedNoteDraft => ({
  statement,
  kind: 'ambiguous',
  heading: heading || undefined,
});

/** One classified statement into the sink. Split out of the loop to keep each rule readable. */
const admitStatement = (
  sink: Sink,
  verdict: ProseStatementClass,
  statement: string,
  section: SpecSection,
): void => {
  const heading = section.heading;
  if (verdict === 'requirement' || verdict === 'preservation') {
    sink.requirements.push(
      toDraft(statement, heading, verdict === 'preservation' ? 'preserve' : 'change'),
    );
    return;
  }
  if (verdict === 'vague-preservation') {
    // Not uncertainty about what the sentence IS — the author was clear. It is a boundary with
    // nothing to anchor to, so it is asked back rather than counted against the extraction.
    sink.questions.push(boundaryQuestionFor(statement, heading));
    sink.notes.push(ambiguousNote(statement, heading));
    return;
  }
  if (verdict === 'uncertain') {
    sink.uncertainCount += 1;
    sink.notes.push(ambiguousNote(statement, heading));
    sink.questions.push(questionFor(statement, heading));
    return;
  }
  // Rejected prose in a role-less section would otherwise vanish; recognized roles already
  // produced their paragraph-level notes in the structured pass.
  if (section.role === 'unknown') {
    sink.notes.push({ statement, kind: 'context', heading: heading || undefined });
  }
};

const admitSection = (sink: Sink, section: SpecSection): void => {
  const strict = STRICT_ROLES.includes(section.role);
  for (const statement of proseStatements(section.lines.join('\n'))) {
    admitStatement(
      sink,
      strict ? strictVerdict(statement) : classifyStatement(statement),
      statement,
      section,
    );
  }
};

/**
 * Graduated prose extraction — replaces the all-or-nothing sentence-split fallback. Runs only
 * when a document declared no structured requirement items at all.
 */
export const admitProse = (sections: readonly SpecSection[]): ProseAdmission => {
  const sink: Sink = { requirements: [], notes: [], questions: [], uncertainCount: 0 };
  for (const section of sections) {
    if (!EXCLUDED_ROLES.includes(section.role)) {
      admitSection(sink, section);
    }
  }
  return sink;
};
