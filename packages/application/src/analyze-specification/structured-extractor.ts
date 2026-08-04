import { isProvisional, strategyFor } from '@impactgraph/domain';

import { itemsOf, paragraphsOf } from './spec-items.js';
import { splitSections } from './spec-sections.js';
import { conceptsOf, classifyType, priorityOf, proseStatements } from './statement-analysis.js';

import type {
  ExtractedNoteDraft,
  ExtractedRequirementDraft,
  SpecificationExtraction,
} from './extraction-types.js';
import type { SpecItem } from './spec-items.js';
import type { SectionRole, SpecSection } from './spec-sections.js';
import type { RequirementOrigin, SpecNoteKind } from '@impactgraph/domain';

/**
 * Structure-respecting deterministic extraction (item 1 of the trial follow-up).
 *
 * The rule the previous extractor broke: a specification's own structure outranks any heuristic.
 * If the author wrote R1–R7, the analysis is about seven requirements. If they wrote a
 * Non-goals section, those statements are exclusions. Sentence-splitting is the LAST resort, used
 * only when the document declares no structured content at all — and when it is used, it is
 * reported prominently rather than presented as though the requirements were the author's.
 */

/** Sections whose list items are requirements. */
const REQUIREMENT_ROLES: readonly SectionRole[] = ['requirements', 'acceptance-criteria', 'tasks'];

const NOTE_KIND_BY_ROLE: Readonly<Partial<Record<SectionRole, SpecNoteKind>>> = {
  context: 'context',
  'implementation-notes': 'implementation-note',
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

const PROSE_ORIGIN: RequirementOrigin = 'prose-fallback';

/**
 * Last resort. Only reached when the document declared no requirement list of any kind, and the
 * result is flagged provisional so nothing downstream treats these statements as the author's.
 */
const proseFallback = (sections: readonly SpecSection[]): ExtractedRequirementDraft[] => {
  const drafts: ExtractedRequirementDraft[] = [];
  for (const section of sections) {
    // Sections that are definitionally NOT requirements stay out of the fallback too — a
    // non-goal must never become a positive requirement, however desperate the extractor is.
    if (section.role === 'non-goals' || section.role === 'open-questions') {
      continue;
    }
    for (const statement of proseStatements(section.lines.join('\n'))) {
      const priority = priorityOf(statement);
      drafts.push({
        statement,
        type: classifyType(statement),
        concepts: conceptsOf(statement),
        actors: [],
        ...(priority === undefined ? {} : { priority }),
        sourceExcerpt: statement,
        origin: PROSE_ORIGIN,
        ...(section.heading.length === 0 ? {} : { heading: section.heading }),
      });
    }
  }
  return drafts;
};

const fallbackWarning = (count: number, provisional: boolean): string =>
  `FALLBACK EXTRACTION: the specification declared no requirements list, acceptance criteria, or ` +
  `task list, so all ${String(count)} requirement(s) below were cut out of running prose by the ` +
  `extractor — they are the extractor's reading, not the author's list.` +
  (provisional
    ? ' The analysis is PROVISIONAL and readiness is withheld. Add an explicit requirements' +
      ' section (R1, R2, … or a numbered list) and re-submit.'
    : ' Add an explicit requirements section to remove the guesswork.');

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
  const prose = structured.length === 0 ? proseFallback(sections) : [];
  const requirements = [...structured, ...dedupeByStatement(prose)];
  const ambiguous = requirements
    .filter((draft) => isAmbiguous(draft.statement))
    .map((draft) => noteFor(draft.statement, 'ambiguous', draft.heading ?? ''));
  return {
    requirements,
    actors: [],
    constraints: [...new Set(accumulator.constraints)],
    openQuestions: accumulator.questions.map((question) => ({
      question,
      reason: 'stated as an open question in the specification',
      severity: 'important',
      affectedRequirementStatements: [],
    })),
    notes: [...accumulator.notes, ...ambiguous],
    quality: qualityReport(structured.length, prose.length, accumulator.recognizedSections),
  };
};

const qualityReport = (
  structured: number,
  prose: number,
  recognizedSections: readonly string[],
): SpecificationExtraction['quality'] => {
  const provisional = isProvisional(structured, prose);
  return {
    strategy: strategyFor(structured, prose),
    structuredRequirementCount: structured,
    proseRequirementCount: prose,
    recognizedSections,
    provisional,
    warnings: structured === 0 && prose > 0 ? [fallbackWarning(prose, provisional)] : [],
  };
};
