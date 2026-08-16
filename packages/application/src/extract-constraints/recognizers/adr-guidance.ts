import type { ConstraintRecognizer, ExtractedConstraint, GuardFile } from '../types.js';

/**
 * Accepted architecture decisions, indexed as advisory guidance.
 *
 * An ADR that forbids what a plan proposes is exactly the evidence a reviewer wished the analysis
 * had surfaced — but its rule is prose, and pretending to have parsed prose is how fabricated
 * findings happen. So this recognizer extracts only what the document structure states: that an
 * ACCEPTED decision exists, its title, and which repository paths its text literally names. The
 * result GOVERNS those scopes at `advisory` severity (enforced by the domain constructor); the
 * finding it later produces says "read this before implementing", never "this is violated".
 */

const ADR_PATH = /(^|\/)(adrs?|decisions)\/[^/]+\.(md|markdown)$/i;

/** `Status: Accepted`, or an `## Status` heading followed by the word. First 4 KB only. */
const ACCEPTED = /(^|\n)\s*(?:\*{0,2}status\*{0,2}\s*[:*]?\s*|## status\s*\n+\s*)accepted\b/i;

/** Repository paths the text literally names — the only scope prose can honestly provide. */
const PATH_MENTION = /\b((?:packages|apps|services|libs|src|scripts|infra|ci)\/[A-Za-z0-9_-]+)/g;

const MAX_SCOPE_GLOBS = 8;

const titleOf = (content: string, path: string): string => {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  if (heading === undefined) {
    return path;
  }
  // "ADR-0011: No hosted backend in v1" → keep the decision's own words after the identifier.
  return heading.replace(/^adr[-\s]?\d+\s*[:—-]\s*/i, '').trim() || heading;
};

const scopeGlobs = (content: string): readonly string[] => {
  const globs = new Set<string>();
  for (const match of content.matchAll(PATH_MENTION)) {
    const mention = match[1];
    if (mention !== undefined) {
      globs.add(`${mention}/**`);
    }
    if (globs.size >= MAX_SCOPE_GLOBS) {
      break;
    }
  }
  return [...globs].sort();
};

export const adrGuidanceRecognizer: ConstraintRecognizer = {
  id: 'adr-guidance',
  appliesTo: (path) => ADR_PATH.test(path),
  recognize: (file: GuardFile): readonly ExtractedConstraint[] => {
    const head = file.content.slice(0, 4096);
    if (!ACCEPTED.test(head)) {
      return [];
    }
    const globs = scopeGlobs(file.content);
    if (globs.length === 0) {
      // A decision that names no path governs nothing checkable; an unscoped advisory constraint
      // would attach itself to every plan, which is noise pretending to be diligence.
      return [];
    }
    const title = titleOf(head, file.path);
    return [
      {
        name: `Accepted decision: ${title}`,
        kind: 'architecture-guidance',
        severity: 'advisory',
        extraction: 'recognized',
        scope: { pathGlobs: [...globs] },
        rule: {
          relation: 'GOVERNS',
          statement: `the accepted decision '${title}' (${file.path}) governs this area — its rule is prose and was not machine-checked`,
        },
        exemptions: [],
        sourceLine: 1,
        recognizer: 'adr-guidance',
      },
    ];
  },
};
