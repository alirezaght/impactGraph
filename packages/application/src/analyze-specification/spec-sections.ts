// Structure-aware specification reading (trial finding: "Explicit numbered requirements were
// ignored and prose was sentence-split into dozens of fake requirements"; "Non-goals and context
// were treated as requirements").
//
// A specification is a document with sections, and the section a statement sits under is the single
// strongest signal about what the statement IS. Reading the text as an undifferentiated stream
// throws that signal away before any other rule gets a chance to use it. Pure: no I/O, no clock.

/** What a heading means for extraction. */
export type SectionRole =
  /** Statements here are requirements. */
  | 'requirements'
  /** Statements here are requirements, tested by observable outcome. */
  | 'acceptance-criteria'
  /** Statements here are requirements phrased as work items. */
  | 'tasks'
  /** Explanatory — never a requirement. */
  | 'context'
  /** A constraint on the solution, kept in `constraints`. */
  | 'constraints'
  /** An explicit exclusion — a negative signal, never a positive impact. */
  | 'non-goals'
  /**
   * A regression boundary: statements here are requirements that the named surfaces must NOT
   * change. Not a non-goal — the components stay in scope and are expected to be exercised.
   */
  | 'preservation'
  /** A recorded design/technical decision — advisory how-to, never a requirement on its own. */
  | 'decisions'
  /** Intent framing (goals, objectives, scope) — explanatory, never a requirement. */
  | 'goals'
  /** Advisory how-to — never a requirement on its own. */
  | 'implementation-notes'
  /** Open questions the author already knows about. */
  | 'open-questions'
  /** Not recognized: contributes only through explicit labels found inside it. */
  | 'unknown';

interface HeadingRule {
  readonly role: SectionRole;
  readonly pattern: RegExp;
}

/**
 * Heading vocabulary. Order matters — the first match wins, so the more specific phrasings come
 * first ("out of scope" before "scope", "non-functional requirements" before "requirements").
 */
const HEADING_RULES: readonly HeadingRule[] = [
  // FIRST, and specifically ahead of `requirements`: `behaviou?rs?` there matched "Unchanged
  // behaviour" and turned a section of things that must NOT change into positive change
  // predictions — the inverted meaning of the document. Ahead of `non-goals` is safe because the
  // two vocabularies are disjoint: nothing here matches "non-goals", "out of scope" or "excluded",
  // and a heading about unchanged behaviour is preservation, not exclusion.
  {
    role: 'preservation',
    pattern:
      /\b(explicitly\s+unchanged|(?:must\s+)?remain(?:s)?\s+unchanged|unchanged\s+behaviou?rs?|preserved\s+behaviou?rs?|behaviou?rs?\s+preserved)\b/i,
  },
  {
    role: 'preservation',
    pattern:
      /\b(regression\s+(?:boundar(?:y|ies)|guards?)|backwards?[-\s]?compat(?:ibility|ible)?|no\s+(?:behaviou?r(?:al)?|functional)\s+change)\b/i,
  },
  { role: 'non-goals', pattern: /\b(non[-\s]?goals?|out[-\s]of[-\s]scope|not\s+in\s+scope)\b/i },
  { role: 'non-goals', pattern: /\b(explicitly\s+)?excluded\b/i },
  {
    role: 'acceptance-criteria',
    pattern: /\b(acceptance\s+criteri(a|on)|definition\s+of\s+done|success\s+criteria)\b/i,
  },
  { role: 'tasks', pattern: /\b(tasks?|work\s?items?|to\s?do|subtasks?|checklist)\b/i },
  { role: 'open-questions', pattern: /\b(open\s+questions?|questions?|unknowns?|to\s+clarify)\b/i },
  {
    role: 'implementation-notes',
    pattern: /\b(implementation\s+notes?|notes?\s+for\s+implement|technical\s+notes?|hints?)\b/i,
  },
  { role: 'constraints', pattern: /\b(constraints?|limitations?|assumptions?|invariants?)\b/i },
  {
    role: 'context',
    pattern: /\b(context|background|motivation|why|problem\s+statement|intro)\b/i,
  },
  // Field feedback: realistic specs carry Decisions/Goals sections. Their statements are NOT
  // requirements — but the sections must be recognized so their content lands somewhere instead
  // of vanishing. After context so "design constraints"/"goals and motivation" keep their roles.
  { role: 'decisions', pattern: /\b(decisions?|design|approach|architecture\s+notes?)\b/i },
  { role: 'goals', pattern: /\b(goals?|objectives?|scope)\b/i },
  {
    role: 'requirements',
    pattern: /\b(requirements?|behaviou?rs?|what\s+to\s+(build|change|implement)|changes?)\b/i,
  },
];

export const roleForHeading = (heading: string): SectionRole => {
  for (const rule of HEADING_RULES) {
    if (rule.pattern.test(heading)) {
      return rule.role;
    }
  }
  return 'unknown';
};

/** A `# heading` line with its own text and the character offset of its body. */
export interface SpecSection {
  /** Verbatim heading text, without the `#` markers. Empty for the implicit preamble. */
  readonly heading: string;
  readonly role: SectionRole;
  /** Heading depth; 0 for the implicit preamble before the first heading. */
  readonly level: number;
  /** Body lines, verbatim, in document order. */
  readonly lines: readonly string[];
  /** Offset of the first body character in rawText — keeps sourceRange honest. */
  readonly bodyStartOffset: number;
}

const ATX_HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const SETEXT_UNDERLINE = /^(=+|-{3,})\s*$/;

interface Builder {
  heading: string;
  level: number;
  lines: string[];
  bodyStartOffset: number;
}

const finish = (sections: SpecSection[], current: Builder): void => {
  if (current.heading.length === 0 && current.lines.every((line) => line.trim().length === 0)) {
    return;
  }
  sections.push({
    heading: current.heading,
    role: current.heading.length === 0 ? 'unknown' : roleForHeading(current.heading),
    level: current.level,
    lines: current.lines,
    bodyStartOffset: current.bodyStartOffset,
  });
};

/**
 * Split markdown into sections. Supports ATX (`## Heading`) and setext (`Heading\n-----`)
 * headings; text before the first heading becomes an unnamed preamble section so nothing is lost.
 */
interface Heading {
  readonly heading: string;
  readonly level: number;
  /** Characters consumed, including the underline of a setext heading. */
  readonly consumed: number;
  /** True when the heading spanned two lines (setext), so the scanner skips the underline. */
  readonly twoLine: boolean;
}

const headingAt = (line: string, nextLine: string): Heading | undefined => {
  const atx = ATX_HEADING.exec(line);
  if (atx !== null) {
    return {
      heading: atx[2] ?? '',
      level: atx[1]?.length ?? 1,
      consumed: line.length + 1,
      twoLine: false,
    };
  }
  const isSetext =
    line.trim().length > 0 && SETEXT_UNDERLINE.test(nextLine) && !LIST_MARKER.test(line.trim());
  if (!isSetext) {
    return pseudoHeadingAt(line);
  }
  return {
    heading: line.trim(),
    level: nextLine.trimEnd().startsWith('=') ? 1 : 2,
    consumed: line.length + 1 + nextLine.length + 1,
    twoLine: true,
  };
};

// Formatting tolerance (field feedback): authors write `**Acceptance Criteria**` or
// `Acceptance Criteria:` as headings, and treating those lines as body prose silently drops the
// document's whole structure. Deliberately conservative — the line must stand alone, be short and
// title-like, and (for the colon form) match the heading vocabulary. ATX/setext take precedence.

/** A line that is nothing but one bold/italic phrase, optionally colon-terminated. */
const EMPHASIS_ONLY = /^(\*{1,2}|_{1,2})([^*_]+?)\1:?$/;
/** A short line ending with `:` — a heading only when the vocabulary recognizes its text. */
const COLON_HEADING = /^[A-Z][^:]{0,47}:$/;
/** A list item is never a pseudo-heading, even when it is bold or colon-terminated. */
const LIST_MARKER = /^([-*+•–—]\s|\d{1,3}[.)]\s)/;
/** Deeper than any real heading in practice, so an enclosing ATX section keeps its role. */
const PSEUDO_LEVEL = 3;
const MAX_PSEUDO_LENGTH = 60;
const MAX_PSEUDO_WORDS = 6;

/** Title-like: a few words, no sentence-ending punctuation. `**Do not ship this.**` is emphasis. */
const isShortTitle = (text: string): boolean =>
  text.length > 0 && text.split(/\s+/).length <= MAX_PSEUDO_WORDS && !/[.!?]$/.test(text);

const pseudoHeadingAt = (line: string): Heading | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PSEUDO_LENGTH || LIST_MARKER.test(trimmed)) {
    return undefined;
  }
  const consumed = line.length + 1;
  const emphasis = EMPHASIS_ONLY.exec(trimmed);
  if (emphasis !== null) {
    const text = (emphasis[2] ?? '').trim().replace(/:$/, '').trim();
    return isShortTitle(text)
      ? { heading: text, level: PSEUDO_LEVEL, consumed, twoLine: false }
      : undefined;
  }
  if (COLON_HEADING.test(trimmed)) {
    const text = trimmed.slice(0, -1).trim();
    if (isShortTitle(text) && roleForHeading(text) !== 'unknown') {
      return { heading: text, level: PSEUDO_LEVEL, consumed, twoLine: false };
    }
  }
  return undefined;
};

export const splitSections = (rawText: string): readonly SpecSection[] => {
  const lines = rawText.split('\n');
  const sections: SpecSection[] = [];
  let current: Builder = { heading: '', level: 0, lines: [], bodyStartOffset: 0 };
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const found = headingAt(line, lines[index + 1] ?? '');
    if (found === undefined) {
      current.lines.push(line);
      offset += line.length + 1;
      continue;
    }
    finish(sections, current);
    offset += found.consumed;
    current = {
      heading: found.heading,
      level: found.level,
      lines: [],
      bodyStartOffset: offset,
    };
    if (found.twoLine) {
      index += 1;
    }
  }
  finish(sections, current);
  return applyInheritance(sections);
};

/**
 * A deeper heading with no recognizable role inherits the nearest shallower recognized role.
 * "## Requirements / ### Backend / - the API must …" is one requirements list, not a requirements
 * heading followed by an unrelated section.
 */
const applyInheritance = (sections: readonly SpecSection[]): readonly SpecSection[] => {
  const stack: { level: number; role: SectionRole }[] = [];
  return sections.map((section) => {
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= section.level) {
      stack.pop();
    }
    const role =
      section.role === 'unknown' ? (stack[stack.length - 1]?.role ?? 'unknown') : section.role;
    if (section.level > 0) {
      stack.push({ level: section.level, role });
    }
    return role === section.role ? section : { ...section, role };
  });
};
