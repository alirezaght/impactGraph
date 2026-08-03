/**
 * Effective-LOC analyzer (ADR-0012, docs/engineering/effective-loc-policy.md).
 *
 * Counting is tokenizer-based: the file is parsed with the TypeScript compiler
 * (`ts.createSourceFile`), the AST is walked down to its leaf tokens, and every
 * token is mapped back to the source lines it spans. A line is *effective* when
 * it carries at least one real code token. Excluded lines:
 *   - blank lines and lines containing only comments (line, block, JSDoc) —
 *     comments are trivia, so they produce no tokens at all;
 *   - lines whose tokens all belong to `import` declarations;
 *   - pure re-export lines (`export type {...} from`, `export * from '...'`,
 *     `export {...} from` when every specifier is type-only);
 *   - lines whose only tokens are punctuation: `{ } ( ) [ ] ; ,`;
 *   - the shebang line.
 * Template literals, strings, regexes, and JSX text are single tokens to the
 * parser, so comment markers inside them can never be mistaken for comments.
 *
 * Extension seam: implement `EffectiveLocAnalyzer` for another language and
 * `defaultRegistry.register(...)` it (see README.md, "Adding a language analyzer").
 */
import ts from 'typescript';

export type LineKind =
  'blank' | 'comment' | 'shebang' | 'import' | 're-export' | 'punctuation-only' | 'code';

export interface LineClassification {
  /** 1-based line number. */
  line: number;
  kind: LineKind;
  effective: boolean;
}

export interface EffectiveLocResult {
  effectiveLines: number;
  totalLines: number;
  /** Per-line detail, one entry per counted source line (used by tests and reports). */
  lines: LineClassification[];
}

/** One analyzer per language family. Register implementations on a registry. */
export interface EffectiveLocAnalyzer {
  readonly id: string;
  supports(filePath: string): boolean;
  analyze(fileName: string, sourceText: string): EffectiveLocResult;
}

export class AnalyzerRegistry {
  private readonly analyzers: EffectiveLocAnalyzer[] = [];

  register(analyzer: EffectiveLocAnalyzer): void {
    this.analyzers.push(analyzer);
  }

  /** First registered analyzer that supports the path wins. */
  find(filePath: string): EffectiveLocAnalyzer | undefined {
    return this.analyzers.find((analyzer) => analyzer.supports(filePath));
  }

  list(): readonly EffectiveLocAnalyzer[] {
    return this.analyzers;
  }
}

const PUNCTUATION_ONLY_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.CommaToken,
]);

type Exclusion = 'import' | 're-export';

interface LineFlags {
  hasToken: boolean;
  hasEffectiveToken: boolean;
  exclusion: Exclusion | undefined;
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * True for re-export declarations that contribute no runtime statements worth
 * counting: `export type {...} from`, `export * from '...'`, and
 * `export {...} from` where every specifier is type-only.
 * `export * as ns from '...'` introduces a value binding and still counts.
 */
function isPureReExport(node: ts.ExportDeclaration): boolean {
  if (node.moduleSpecifier === undefined) return false;
  if (node.isTypeOnly) return true;
  if (node.exportClause === undefined) return true;
  if (ts.isNamedExports(node.exportClause)) {
    return (
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly)
    );
  }
  return false;
}

/** Shared state threaded through the token walk. */
interface MarkContext {
  readonly sourceFile: ts.SourceFile;
  readonly sourceText: string;
  readonly lineStarts: readonly number[];
  readonly flags: LineFlags[];
}

function lineOf(context: MarkContext, position: number): number {
  return context.sourceFile.getLineAndCharacterOfPosition(position).line;
}

function markLine(
  context: MarkContext,
  line: number,
  effective: boolean,
  exclusion: Exclusion | undefined,
): void {
  const entry = context.flags[line];
  if (entry === undefined) return;
  entry.hasToken = true;
  if (effective) entry.hasEffectiveToken = true;
  else if (exclusion !== undefined && entry.exclusion === undefined) entry.exclusion = exclusion;
}

/** JSX text: only lines with non-whitespace text content count as code. */
function markJsxText(context: MarkContext, node: ts.JsxText): void {
  const start = node.getStart(context.sourceFile);
  const lastLine = lineOf(context, Math.max(start, node.end - 1));
  for (let line = lineOf(context, start); line <= lastLine; line += 1) {
    const from = Math.max(start, context.lineStarts[line] ?? start);
    const to = Math.min(node.end, context.lineStarts[line + 1] ?? node.end);
    if (context.sourceText.slice(from, to).trim() !== '') markLine(context, line, true, undefined);
  }
}

function markToken(context: MarkContext, node: ts.Node, exclusion: Exclusion | undefined): void {
  const start = node.getStart(context.sourceFile);
  if (start >= node.end) return; // zero-width: EndOfFileToken, missing nodes, empty lists
  if (ts.isJsxText(node)) {
    if (!node.containsOnlyTriviaWhiteSpaces) markJsxText(context, node);
    return;
  }
  const effective = exclusion === undefined && !PUNCTUATION_ONLY_KINDS.has(node.kind);
  const lastLine = lineOf(context, node.end - 1);
  for (let line = lineOf(context, start); line <= lastLine; line += 1) {
    markLine(context, line, effective, exclusion);
  }
}

/** Exclusion inherited by the children of `node` (import / pure re-export subtrees). */
function childExclusion(node: ts.Node, inherited: Exclusion | undefined): Exclusion | undefined {
  if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return 'import';
  if (ts.isExportDeclaration(node) && isPureReExport(node)) return 're-export';
  return inherited;
}

/** JSDoc appears in getChildren(); it is a comment, never code. */
function isJsDocNode(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

function visitNode(context: MarkContext, node: ts.Node, exclusion: Exclusion | undefined): void {
  if (isJsDocNode(node)) return;
  const next = childExclusion(node, exclusion);
  const children = node.getChildren(context.sourceFile);
  if (children.length === 0) {
    markToken(context, node, next);
    return;
  }
  for (const child of children) visitNode(context, child, next);
}

/** A trailing newline does not start a countable extra line; empty text has none. */
function countTotalLines(sourceText: string, lineStartCount: number): number {
  if (sourceText.length === 0) return 0;
  const endsWithNewline = sourceText.endsWith('\n') || sourceText.endsWith('\r');
  return endsWithNewline ? lineStartCount - 1 : lineStartCount;
}

function classifyLine(entry: LineFlags, rawLine: string, isFirstLine: boolean): LineKind {
  if (!entry.hasToken) {
    if (rawLine.trim() === '') return 'blank';
    return isFirstLine && rawLine.startsWith('#!') ? 'shebang' : 'comment';
  }
  if (entry.hasEffectiveToken) return 'code';
  if (entry.exclusion !== undefined) return entry.exclusion;
  return 'punctuation-only';
}

function buildLineClassifications(context: MarkContext, totalLines: number): LineClassification[] {
  const lines: LineClassification[] = [];
  for (let index = 0; index < totalLines; index += 1) {
    const entry = context.flags[index] ?? {
      hasToken: false,
      hasEffectiveToken: false,
      exclusion: undefined,
    };
    const lineStart = context.lineStarts[index] ?? 0;
    const nextStart = context.lineStarts[index + 1] ?? context.sourceText.length;
    const raw = context.sourceText.slice(lineStart, nextStart).replace(/[\r\n]+$/, '');
    const kind = classifyLine(entry, raw, index === 0);
    lines.push({ line: index + 1, kind, effective: kind === 'code' });
  }
  return lines;
}

export function analyzeEffectiveLoc(fileName: string, sourceText: string): EffectiveLocResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(fileName),
  );
  const lineStarts = sourceFile.getLineStarts();
  const context: MarkContext = {
    sourceFile,
    sourceText,
    lineStarts,
    flags: lineStarts.map(() => ({
      hasToken: false,
      hasEffectiveToken: false,
      exclusion: undefined,
    })),
  };
  visitNode(context, sourceFile, undefined);

  const totalLines = countTotalLines(sourceText, lineStarts.length);
  const lines = buildLineClassifications(context, totalLines);
  return {
    effectiveLines: lines.filter((line) => line.effective).length,
    totalLines,
    lines,
  };
}

const TS_FAMILY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

export const typescriptAnalyzer: EffectiveLocAnalyzer = {
  id: 'typescript',
  supports: (filePath: string): boolean => {
    const lower = filePath.toLowerCase();
    return TS_FAMILY_EXTENSIONS.some((extension) => lower.endsWith(extension));
  },
  analyze: analyzeEffectiveLoc,
};

/** Registry used by the CLI. Additional language analyzers register here. */
export const defaultRegistry = new AnalyzerRegistry();
defaultRegistry.register(typescriptAnalyzer);
