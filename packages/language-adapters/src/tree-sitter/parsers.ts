import { Language, Parser } from 'web-tree-sitter';

import { nodeGrammarSource } from './grammars.js';
import { errorRecoveryWarnings } from './syntax.js';

import type { GrammarId, GrammarSource } from './grammars.js';
import type { Node } from 'web-tree-sitter';

// The tree-sitter WASM foundation (ADR-0008). Two rules shape this module:
//
// 1. Initialization is LAZY. `Parser.init()` instantiates a WebAssembly runtime and every
//    grammar load compiles a second module; doing that at import time would spend the whole
//    500 ms activation budget (PRD §33) before a single file is read. Adapters are constructed
//    eagerly at composition time, so the work must happen on first parse instead.
// 2. Nothing here throws. A missing grammar, a broken `.wasm`, or a parser failure becomes a
//    warning string the adapter records; the run continues at file level (PRD §32, §34).

export interface SyntaxTreeResult<T> {
  /** undefined when the grammar could not be loaded or the parse produced no tree. */
  readonly value: T | undefined;
  readonly warnings: readonly string[];
}

export interface TreeSitterParsers {
  /**
   * Parse `content` with one grammar and hand the root node to `visit`. The tree is deleted
   * before returning, so callers can never leak WASM memory — extract what you need inside
   * `visit` and return plain data.
   */
  withSyntaxTree<T>(
    grammarId: GrammarId,
    content: string,
    visit: (root: Node) => T,
  ): Promise<SyntaxTreeResult<T>>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class ParserPool implements TreeSitterParsers {
  private readonly source: GrammarSource;
  private runtime: Promise<void> | undefined;
  /** One Parser (and its Language) per grammar, cached for the lifetime of the process. */
  private readonly parsers = new Map<GrammarId, Promise<Parser>>();

  public constructor(source: GrammarSource) {
    this.source = source;
  }

  public async withSyntaxTree<T>(
    grammarId: GrammarId,
    content: string,
    visit: (root: Node) => T,
  ): Promise<SyntaxTreeResult<T>> {
    let parser: Parser;
    try {
      parser = await this.parserFor(grammarId);
    } catch (error) {
      return { value: undefined, warnings: [grammarFailure(grammarId, error)] };
    }
    return runVisit(parser, grammarId, content, visit);
  }

  private parserFor(grammarId: GrammarId): Promise<Parser> {
    const cached = this.parsers.get(grammarId);
    if (cached !== undefined) {
      return cached;
    }
    const loading = this.loadParser(grammarId);
    this.parsers.set(grammarId, loading);
    return loading;
  }

  private async loadParser(grammarId: GrammarId): Promise<Parser> {
    this.runtime ??= Parser.init();
    await this.runtime;
    const language = await Language.load(await this.source(grammarId));
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  }
}

const grammarFailure = (grammarId: GrammarId, error: unknown): string =>
  `tree-sitter grammar '${grammarId}' unavailable: ${messageOf(error)}`;

const runVisit = <T>(
  parser: Parser,
  grammarId: GrammarId,
  content: string,
  visit: (root: Node) => T,
): SyntaxTreeResult<T> => {
  let tree;
  try {
    tree = parser.parse(content);
  } catch (error) {
    return {
      value: undefined,
      warnings: [`tree-sitter '${grammarId}' parse failed: ${messageOf(error)}`],
    };
  }
  if (tree === null) {
    return { value: undefined, warnings: [`tree-sitter '${grammarId}' produced no syntax tree`] };
  }
  try {
    return { value: visit(tree.rootNode), warnings: errorRecoveryWarnings(tree.rootNode) };
  } finally {
    tree.delete();
  }
};

/** A fresh pool — used by tests and by any host that supplies its own grammar bytes. */
export const createTreeSitterParsers = (
  source: GrammarSource = nodeGrammarSource,
): TreeSitterParsers => new ParserPool(source);

let shared: TreeSitterParsers | undefined;

/**
 * The process-wide pool every built-in adapter shares, so a grammar is compiled at most once per
 * process. Created on first call — importing this module compiles nothing.
 */
export const sharedTreeSitterParsers = (): TreeSitterParsers => {
  shared ??= createTreeSitterParsers();
  return shared;
};
