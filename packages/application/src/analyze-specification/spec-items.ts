import type { SpecSection } from './spec-sections.js';
import type { RequirementOrigin } from '@impactgraph/domain';

// List-item extraction inside one section. Pure text work, deliberately separate from the
// section-role decision (spec-sections.ts) and from the draft assembly (structured-extractor.ts).

/** A statement lifted out of a section, with the shape of list item it came from. */
export interface SpecItem {
  readonly text: string;
  readonly origin: RequirementOrigin;
  /** Author-assigned identifier when the item declared one: `R3`, `AC-2`, `FR7`. */
  readonly label?: string;
}

/**
 * An author-assigned requirement identifier at the start of a statement.
 *
 * Deliberately narrow. It matches a short uppercase prefix followed by digits and a separator —
 * `R1:`, `R1.`, `FR-3)`, `REQ 12 —`, and the bolded `**R1**` — because those are identifiers.
 * It does not match a bare number: "1. the API must …" is a numbered item, which is a different
 * origin with a different meaning (the author ordered their list; they did not name its entries).
 */
const EXPLICIT_LABEL = /^\**((?:[A-Z]{1,4})[-\s]?\d{1,3}(?:\.\d{1,2})?)\**\s*[:.)\]–—-]\s+(?=\S)/;

/** `1.` / `2)` / `10.` — an ordered-list marker, with no author identifier attached. */
const NUMBERED_MARKER = /^(\d{1,3})[.)]\s+(?=\S)/;

/** `- [ ]` / `* [x]` — a task-list item. */
const TASK_MARKER = /^[-*+]\s+\[[ xX]\]\s+(?=\S)/;

/** A plain bullet. `•`/`–`/`—` are accepted too — authors paste them from rich-text editors. */
const BULLET_MARKER = /^[-*+•–—]\s+(?=\S)/;

/** Nested list items are continuations of their parent item, not requirements of their own. */
const INDENT = /^(\s*)/;

const ORIGIN_BY_ROLE: Readonly<Record<string, RequirementOrigin>> = {
  requirements: 'bullet-item',
  'acceptance-criteria': 'acceptance-criterion',
  tasks: 'task-item',
};

const stripEmphasis = (text: string): string =>
  text
    .replace(/^\*\*(.+?)\*\*:?\s*/, '$1: ')
    .replace(/\s+/g, ' ')
    .trim();

interface Pending {
  text: string;
  origin: RequirementOrigin;
  label?: string;
  indent: number;
}

const flush = (items: SpecItem[], pending: Pending | undefined): void => {
  if (pending === undefined) {
    return;
  }
  const text = stripEmphasis(pending.text);
  if (text.length < 3) {
    return;
  }
  items.push({
    text,
    origin: pending.origin,
    ...(pending.label === undefined ? {} : { label: pending.label }),
  });
};

/** Fenced code inside a specification is an example, never a requirement statement. */
const FENCE = /^\s*(```|~~~)/;

interface ScanState {
  readonly items: SpecItem[];
  pending: Pending | undefined;
  inFence: boolean;
}

const startItem = (
  line: string,
  indent: number,
  fallbackOrigin: RequirementOrigin,
): Pending | undefined => {
  const trimmed = line.trim();
  const labelled = EXPLICIT_LABEL.exec(trimmed);
  if (labelled !== null) {
    return {
      text: trimmed.slice(labelled[0].length),
      origin: 'explicit-label',
      label: (labelled[1] ?? '').replace(/\s+/g, '-'),
      indent,
    };
  }
  const task = TASK_MARKER.exec(trimmed);
  if (task !== null) {
    return { text: trimmed.slice(task[0].length), origin: 'task-item', indent };
  }
  const numbered = NUMBERED_MARKER.exec(trimmed);
  if (numbered !== null) {
    const rest = trimmed.slice(numbered[0].length);
    const inner = EXPLICIT_LABEL.exec(rest);
    // "1. R3: the API must …" — the author's identifier wins over the list position.
    return inner === null
      ? { text: rest, origin: 'numbered-item', label: numbered[1] ?? '', indent }
      : {
          text: rest.slice(inner[0].length),
          origin: 'explicit-label',
          label: (inner[1] ?? '').replace(/\s+/g, '-'),
          indent,
        };
  }
  const bullet = BULLET_MARKER.exec(trimmed);
  if (bullet !== null) {
    return { text: trimmed.slice(bullet[0].length), origin: fallbackOrigin, indent };
  }
  return undefined;
};

/** One non-fence line: start a new item, continue the pending one, or close it. */
const scanLine = (state: ScanState, line: string, fallbackOrigin: RequirementOrigin): void => {
  if (line.trim().length === 0) {
    flush(state.items, state.pending);
    state.pending = undefined;
    return;
  }
  const indent = (INDENT.exec(line)?.[1] ?? '').length;
  const started = startItem(line, indent, fallbackOrigin);
  if (started !== undefined && (state.pending === undefined || indent <= state.pending.indent)) {
    flush(state.items, state.pending);
    state.pending = started;
    return;
  }
  if (state.pending !== undefined) {
    // A wrapped line, or a nested bullet: part of the item above, not a new one.
    state.pending.text = `${state.pending.text} ${line.trim()}`;
  }
};

/**
 * Extract the list items of one section.
 *
 * `labelledOnly` is how an unrecognized section still contributes: a specification that states
 * "R1 … R7" inside a section called "Implementation" has declared seven requirements, and ignoring
 * them because the heading was not in the vocabulary is exactly the trial failure. In that mode,
 * only items carrying an explicit author identifier are returned.
 */
export const itemsOf = (section: SpecSection, labelledOnly = false): readonly SpecItem[] => {
  const fallbackOrigin = ORIGIN_BY_ROLE[section.role] ?? 'bullet-item';
  const state: ScanState = { items: [], pending: undefined, inFence: false };
  for (const line of section.lines) {
    if (FENCE.test(line)) {
      state.inFence = !state.inFence;
      continue;
    }
    if (!state.inFence) {
      scanLine(state, line, fallbackOrigin);
    }
  }
  flush(state.items, state.pending);
  return labelledOnly
    ? state.items.filter((item) => item.origin === 'explicit-label')
    : state.items;
};

/**
 * Paragraph text of a section, with list items, their wrapped continuations, and code fences
 * removed. A continuation line belongs to the item above it — counting it as prose would extract
 * the same statement twice, once as an item and once as a sentence fragment.
 */
export const paragraphsOf = (section: SpecSection): readonly string[] => {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inListItem = false;
  const flushParagraph = (): void => {
    const text = current.join(' ').trim();
    if (text.length >= 12) {
      paragraphs.push(text);
    }
    current = [];
  };
  for (const line of section.lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      flushParagraph();
      continue;
    }
    const trimmed = line.trim();
    if (inFence || trimmed.length === 0) {
      inListItem = false;
      flushParagraph();
      continue;
    }
    if (startItem(line, 0, 'bullet-item') !== undefined) {
      inListItem = true;
      flushParagraph();
      continue;
    }
    if (inListItem || /^(\||>|#{1,6}\s)/.test(trimmed)) {
      continue;
    }
    current.push(trimmed);
  }
  flushParagraph();
  return paragraphs;
};
