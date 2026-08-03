import { isSecretBearingPath, redactSecrets } from './redaction.js';

import type { PrivacyMode } from './guarded-provider.js';

// Story 13.2 — the §9.2 snippet-minimization builder. Every prompt that includes repository
// content assembles it HERE, so the privacy mode has one enforcement point: `selected-snippets`
// (the default) sends symbols, signatures, and explicitly selected ranges only — never file
// bodies; `full-context` may send capped, redacted excerpts; `local-only`/`external-agent`
// produce nothing because no direct provider call is allowed in those modes at all.

export interface SnippetSource {
  readonly filePath: string;
  /** Symbol identity — always allowed (names are already in the graph). */
  readonly symbolName?: string | undefined;
  /** Declaration signature line(s) — allowed from `selected-snippets` up. */
  readonly signature?: string | undefined;
  /** A range the USER explicitly selected — allowed from `selected-snippets` up. */
  readonly selectedText?: string | undefined;
  /** Whole-file or large excerpt — allowed ONLY in `full-context`. */
  readonly fullText?: string | undefined;
}

export interface PromptSnippet {
  readonly filePath: string;
  readonly content: string;
  /** True when content was cut to fit the per-snippet cap. */
  readonly truncated: boolean;
}

export interface SnippetBuildResult {
  readonly snippets: readonly PromptSnippet[];
  /** File paths dropped entirely (secret-bearing, or empty after minimization). */
  readonly excludedPaths: readonly string[];
  readonly redactionCount: number;
}

const PER_SNIPPET_CHARS = 2_000;
const TOTAL_CHARS = 20_000;

const allowedContent = (mode: PrivacyMode, source: SnippetSource): string => {
  const parts: string[] = [];
  if (source.symbolName !== undefined) {
    parts.push(`symbol: ${source.symbolName}`);
  }
  if (source.signature !== undefined) {
    parts.push(source.signature);
  }
  if (source.selectedText !== undefined) {
    parts.push(source.selectedText);
  }
  if (mode === 'full-context' && source.fullText !== undefined) {
    parts.push(source.fullText);
  }
  return parts.join('\n');
};

const capped = (content: string): { content: string; truncated: boolean } =>
  content.length > PER_SNIPPET_CHARS
    ? { content: `${content.slice(0, PER_SNIPPET_CHARS)}\n[TRUNCATED]`, truncated: true }
    : { content, truncated: false };

/**
 * Minimize repository content for a prompt under the active privacy mode (§9.2). Secret-bearing
 * files are excluded wholesale; everything else is secret-redacted and length-capped.
 */
export const buildPromptSnippets = (
  mode: PrivacyMode,
  sources: readonly SnippetSource[],
): SnippetBuildResult => {
  if (mode === 'local-only' || mode === 'external-agent') {
    return { snippets: [], excludedPaths: sources.map((s) => s.filePath), redactionCount: 0 };
  }
  const snippets: PromptSnippet[] = [];
  const excludedPaths: string[] = [];
  let redactionCount = 0;
  let totalChars = 0;
  for (const source of sources) {
    if (isSecretBearingPath(source.filePath) || totalChars >= TOTAL_CHARS) {
      excludedPaths.push(source.filePath);
      continue;
    }
    const raw = allowedContent(mode, source);
    if (raw.length === 0) {
      excludedPaths.push(source.filePath);
      continue;
    }
    const redacted = redactSecrets(raw);
    redactionCount += redacted.redactionCount;
    const fitted = capped(redacted.text);
    totalChars += fitted.content.length;
    snippets.push({ filePath: source.filePath, ...fitted });
  }
  return { snippets, excludedPaths, redactionCount };
};
