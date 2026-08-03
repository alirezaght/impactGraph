import { isAbsolute, join } from 'node:path';

// Story 7.5 — pure node → source resolution and accessibility labels (§18.4, §37, §40.4).
// No vscode types here: this file is unit-tested without Electron. Providers turn the
// returned absolute path into a `vscode.open` command and the resolved range into a
// selection, so a symbol node reveals its declaration rather than the top of the file.

/**
 * Resolve a tree node's file reference to an absolute path, or undefined when the node is
 * not navigable (no workspace, no path, or a non-file evidence label such as `commit …`).
 */
export const resolveSourcePath = (
  rootDir: string | undefined,
  filePath: string | undefined,
): string | undefined => {
  if (rootDir === undefined || filePath === undefined || filePath.length === 0) {
    return undefined;
  }
  if (filePath.startsWith('commit ')) {
    return undefined;
  }
  return isAbsolute(filePath) ? filePath : join(rootDir, filePath);
};

/** Evidence range as the engine reports it (1-based lines, as parsers produce them). */
export interface SourceRangeLike {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** Zero-based positions for `vscode.Range`; VS Code counts from 0, parsers from 1. */
export interface EditorSelection {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/**
 * §40.4: convert a declaration range into an editor selection. A missing or degenerate range
 * (line 0, or an end before its start) yields undefined so the file simply opens at the top —
 * a wrong reveal is worse than none.
 */
export const toEditorSelection = (
  range: SourceRangeLike | undefined,
): EditorSelection | undefined => {
  if (range === undefined || range.startLine < 1) {
    return undefined;
  }
  const endLine = range.endLine >= range.startLine ? range.endLine : range.startLine;
  return {
    startLine: range.startLine - 1,
    startColumn: Math.max(0, range.startColumn - 1),
    endLine: endLine - 1,
    endColumn: Math.max(0, range.endColumn - 1),
  };
};

/**
 * Screen-reader label for a tree item (§37): the visible label plus the description text,
 * so likelihood/provenance/count badges are announced, never conveyed by position alone.
 */
export const accessibilityLabel = (label: string, description?: string): string =>
  description === undefined || description.length === 0 ? label : `${label}, ${description}`;
