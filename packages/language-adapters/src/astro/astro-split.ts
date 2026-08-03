// ADR-0014 — an `.astro` file is TypeScript frontmatter delimited by `---`, followed by an
// HTML-like template. No Astro grammar exists and none is needed: the split is textual, and each
// half then goes to a parser ADR-0008 already sanctioned (the TS compiler API, and tree-sitter
// `html`).
//
// Both halves are returned padded with the newlines that precede them, so the parsers report
// line and column numbers that point at the real position in the real file. Evidence stays
// clickable without a single offset calculation anywhere downstream.

const FENCE = '---';

export interface AstroHalf {
  /** The half's own text, prefixed by one newline per preceding line of the file. */
  readonly paddedSource: string;
  /** Zero-based line the half starts on — for messages, not for range arithmetic. */
  readonly startLine: number;
}

export interface AstroSplit {
  /** Absent for a template-only `.astro` file, which is legal Astro. */
  readonly frontmatter: AstroHalf | undefined;
  readonly template: AstroHalf;
}

export interface AstroSplitFailure {
  readonly reason: string;
}

export type AstroSplitResult =
  | { readonly ok: true; readonly value: AstroSplit }
  | { readonly ok: false; readonly error: AstroSplitFailure };

const half = (lines: readonly string[], startLine: number, endLine: number): AstroHalf => ({
  paddedSource: '\n'.repeat(startLine) + lines.slice(startLine, endLine).join('\n'),
  startLine,
});

const isFence = (line: string): boolean => line.trimEnd() === FENCE;

/** The first non-blank line, which is where a frontmatter fence has to be if there is one. */
const firstContentLine = (lines: readonly string[]): number => {
  const index = lines.findIndex((line) => line.trim() !== '');
  return index === -1 ? lines.length : index;
};

/**
 * Split one `.astro` file. An opening fence with no closing fence is malformed: the rest of the
 * file could be TypeScript or could be markup, and there is no way to tell — so it degrades to a
 * recorded failure rather than a guess (ADR-0014).
 */
export const splitAstroFile = (content: string): AstroSplitResult => {
  const lines = content.split('\n');
  const opening = firstContentLine(lines);
  if (opening >= lines.length || !isFence(lines[opening] ?? '')) {
    // No frontmatter at all — the whole file is template. Legal, and common for pure markup.
    return { ok: true, value: { frontmatter: undefined, template: half(lines, 0, lines.length) } };
  }
  const closing = lines.findIndex((line, index) => index > opening && isFence(line));
  if (closing === -1) {
    return {
      ok: false,
      error: {
        reason: `frontmatter opened with '---' on line ${String(opening + 1)} but never closed`,
      },
    };
  }
  return {
    ok: true,
    value: {
      frontmatter: half(lines, opening + 1, closing),
      template: half(lines, closing + 1, lines.length),
    },
  };
};
