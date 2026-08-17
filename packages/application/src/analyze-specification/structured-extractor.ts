import { isProvisional, strategyFor } from '@impactgraph/domain';

import { admitProse } from './prose-admission.js';
import { itemsOf, paragraphsOf } from './spec-items.js';
import { splitSections } from './spec-sections.js';
import { conceptsOf, classifyType, priorityOf } from './statement-analysis.js';

import type {
  ExtractedNoteDraft,
  ExtractedRequirementDraft,
  SpecificationExtraction,
} from './extraction-types.js';
import type { ProseAdmission } from './prose-admission.js';
import type { SpecItem } from './spec-items.js';
import type { SectionRole, SpecSection } from './spec-sections.js';
import type { SpecNoteKind } from '@impactgraph/domain';

/**
 * Structure-respecting deterministic extraction (item 1 of the trial follow-up).
 *
 * The rule the previous extractor broke: a specification's own structure outranks any heuristic.
 * If the author wrote R1–R7, the analysis is about seven requirements. If they wrote a
 * Non-goals section, those statements are exclusions. When the document declares no structured
 * content at all, prose is read GRADUATED (prose-admission.ts): normative sentences are admitted
 * as requirements, uncertain sentences become open questions, and narration stays context — never
 * the old all-or-nothing sentence split that turned background prose into invented requirements.
 */

/** Sections whose list items are requirements. */
const REQUIREMENT_ROLES: readonly SectionRole[] = ['requirements', 'acceptance-criteria', 'tasks'];

const NOTE_KIND_BY_ROLE: Readonly<Partial<Record<SectionRole, SpecNoteKind>>> = {
  context: 'context',
  // Goals/objectives frame intent — explanatory, like context; never a requirement.
  goals: 'context',
  'implementation-notes': 'implementation-note',
  // Decisions are advisory how-to: they name real components but demand nothing on their own,
  // exactly the implementation-note semantics. Their items must never inflate the requirements.
  decisions: 'implementation-note',
  'non-goals': 'non-goal',
};

/**
 * A statement is too vague to anchor a requirement when it names nothing and commits to nothing:
 * no backticked term, no identifier, and no modal verb. Recorded as ambiguous rather than dropped.
 */
const isAmbiguous = (text: string): boolean =>
  conceptsOf(text).length === 0 && !/\b(must|should|shall|will|needs? to|require)\b/i.test(text);

const toRequirement = (item: SpecItem, section: SpecSection): ExtractedRequirementDraft => {
  const priority = priorityOf(item.text);
  return {
    statement: item.text,
    type: classifyType(item.text),
    concepts: conceptsOf(item.text),
    actors: [],
    ...(priority === undefined ? {} : { priority }),
    sourceExcerpt: item.text,
    origin: item.origin,
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(section.heading.length === 0 ? {} : { heading: section.heading }),
  };
};

const noteFor = (statement: string, kind: SpecNoteKind, heading: string): ExtractedNoteDraft => ({
  statement,
  kind,
  ...(heading.length === 0 ? {} : { heading }),
});

interface Accumulator {
  readonly requirements: ExtractedRequirementDraft[];
  readonly notes: ExtractedNoteDraft[];
  readonly constraints: string[];
  readonly questions: string[];
  readonly recognizedSections: string[];
}

const collectRequirementSection = (accumulator: Accumulator, section: SpecSection): void => {
  for (const item of itemsOf(section)) {
    accumulator.requirements.push(toRequirement(item, section));
  }
  // Prose inside a requirements section describes the requirements around it; it is context, not
  // an extra requirement. Promoting it is how one heading becomes a dozen statements.
  for (const paragraph of paragraphsOf(section)) {
    accumulator.notes.push(noteFor(paragraph, 'context', section.heading));
  }
};

const collectNonRequirementSection = (accumulator: Accumulator, section: SpecSection): void => {
  const kind = NOTE_KIND_BY_ROLE[section.role];
  const statements = [...itemsOf(section).map((item) => item.text), ...paragraphsOf(section)];
  if (section.role === 'constraints') {
    accumulator.constraints.push(...statements);
    return;
  }
  if (section.role === 'open-questions') {
    accumulator.questions.push(...statements);
    return;
  }
  if (kind === undefined) {
    return;
  }
  for (const statement of statements) {
    accumulator.notes.push(noteFor(statement, kind, section.heading));
  }
};

/**
 * Explicit author identifiers anywhere in the document. An unrecognized heading does not cancel
 * "R4: …" — the label is the author stating that this line is a requirement.
 */
const collectStrayLabels = (accumulator: Accumulator, section: SpecSection): void => {
  for (const item of itemsOf(section, true)) {
    accumulator.requirements.push(toRequirement(item, section));
  }
};

const dedupeByStatement = (
  drafts: readonly ExtractedRequirementDraft[],
): ExtractedRequirementDraft[] => {
  const seen = new Set<string>();
  const kept: ExtractedRequirementDraft[] = [];
  for (const draft of drafts) {
    const key = draft.statement.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(draft);
    }
  }
  return kept;
};

const EMPTY_ADMISSION: ProseAdmission = {
  requirements: [],
  notes: [],
  questions: [],
  uncertainCount: 0,
};

// The remediation names every accepted shape — telling the user only the narrowest one
// ("R1, R2, …") sent authors of well-structured specs chasing a format they did not need.
const ACCEPTED_SHAPES =
  'a Requirements, Acceptance Criteria, or task section containing bulleted (-, *, +, •) or ' +
  'numbered items; explicit labels like R1/FR-2 are optional';

/** Graduated extraction succeeded: modal prose is a specification, not a reformat request. */
const proseModalWarning = (admitted: number, uncertain: number): string =>
  `PROSE EXTRACTION: the specification declared no requirements list, acceptance criteria, or ` +
  `task list. ${String(admitted)} normative statement(s) in the prose were admitted as ` +
  `requirements and ${String(uncertain)} uncertain statement(s) were routed to open questions ` +
  `instead of being invented as requirements. An explicit requirements section ` +
  `(${ACCEPTED_SHAPES}) remains more precise, but is not required.`;

/** Little modal signal: the requirement list would be a guess, so that is said out loud. */
const uncertainProseWarning = (admitted: number, uncertain: number, provisional: boolean): string =>
  `FALLBACK EXTRACTION: the specification declared no requirements list and its prose carries ` +
  `little normative signal — ${String(admitted)} statement(s) were admitted as requirements and ` +
  `${String(uncertain)} uncertain statement(s) were routed to open questions rather than ` +
  `invented as requirements.` +
  (provisional
    ? ` The analysis is PROVISIONAL and readiness is withheld. Add ${ACCEPTED_SHAPES} — then re-submit.`
    : ` Add ${ACCEPTED_SHAPES} — that removes the guesswork.`);

export const structuredExtraction = (rawText: string): SpecificationExtraction => {
  const sections = splitSections(rawText);
  const accumulator: Accumulator = {
    requirements: [],
    notes: [],
    constraints: [],
    questions: [],
    recognizedSections: [],
  };
  for (const section of sections) {
    if (section.role !== 'unknown' && section.heading.length > 0) {
      accumulator.recognizedSections.push(section.heading);
    }
    if (REQUIREMENT_ROLES.includes(section.role)) {
      collectRequirementSection(accumulator, section);
      continue;
    }
    collectNonRequirementSection(accumulator, section);
    collectStrayLabels(accumulator, section);
  }
  const structured = dedupeByStatement(accumulator.requirements);
  // Graduated extraction (never all-or-nothing): with no structured list, each prose sentence is
  // classified — normative statements are admitted, uncertain ones become open questions.
  const admission = structured.length === 0 ? admitProse(sections) : EMPTY_ADMISSION;
  const prose = dedupeByStatement(admission.requirements);
  const requirements = [...structured, ...prose];
  const ambiguous = requirements
    .filter((draft) => isAmbiguous(draft.statement))
    .map((draft) => noteFor(draft.statement, 'ambiguous', draft.heading ?? ''));
  return {
    requirements,
    actors: [],
    constraints: [...new Set(accumulator.constraints)],
    openQuestions: [
      ...accumulator.questions.map((question) => ({
        question,
        reason: 'stated as an open question in the specification',
        severity: 'important',
        affectedRequirementStatements: [],
      })),
      // Exposed uncertainty (same channel, lower severity): "is this a requirement or context?"
      ...admission.questions,
    ],
    notes: [...accumulator.notes, ...admission.notes, ...ambiguous],
    quality: qualityReport(
      structured.length,
      prose.length,
      admission.uncertainCount,
      accumulator.recognizedSections,
    ),
  };
};

const qualityReport = (
  structured: number,
  proseModal: number,
  uncertain: number,
  recognizedSections: readonly string[],
): SpecificationExtraction['quality'] => {
  const provisional = isProvisional(structured, proseModal, uncertain);
  const warnings =
    structured > 0 || proseModal + uncertain === 0
      ? []
      : provisional || proseModal === 0
        ? [uncertainProseWarning(proseModal, uncertain, provisional)]
        : [proseModalWarning(proseModal, uncertain)];
  return {
    strategy: strategyFor(structured, proseModal),
    structuredRequirementCount: structured,
    proseRequirementCount: proseModal,
    // Measured only when the graduated pass ran; a structured document's count stays unclaimed.
    ...(structured === 0 ? { uncertainStatementCount: uncertain } : {}),
    recognizedSections,
    provisional,
    warnings,
  };
};
