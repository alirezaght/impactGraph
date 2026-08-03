import { describe, expect, it } from 'vitest';

import { nodeGrammarSource, TREE_SITTER_GRAMMARS } from './grammars.js';
import { createTreeSitterParsers } from './parsers.js';

import type { GrammarSource } from './grammars.js';

// ADR-0008 — the tree-sitter WASM foundation. Two properties matter beyond "it parses": nothing
// is initialized before the first parse (PRD §33 activation budget) and nothing ever throws
// (PRD §34: a missing grammar degrades the run, it does not end it).

describe('tree-sitter parser pool (ADR-0008)', () => {
  it('does not touch the WASM runtime until the first parse', async () => {
    const loads: string[] = [];
    const source: GrammarSource = async (grammarId) => {
      loads.push(grammarId);
      return nodeGrammarSource(grammarId);
    };
    const parsers = createTreeSitterParsers(source);
    expect(loads).toEqual([]);

    await parsers.withSyntaxTree('python', 'x = 1\n', (root) => root.type);
    expect(loads).toEqual(['python']);
  });

  it('compiles each grammar at most once per pool', async () => {
    const loads: string[] = [];
    const parsers = createTreeSitterParsers(async (grammarId) => {
      loads.push(grammarId);
      return nodeGrammarSource(grammarId);
    });
    await parsers.withSyntaxTree('python', 'a = 1\n', () => undefined);
    await parsers.withSyntaxTree('python', 'b = 2\n', () => undefined);
    expect(loads).toEqual(['python']);
  });

  it('exposes the parsed root to the visitor and reports no warnings for valid source', async () => {
    const parsers = createTreeSitterParsers();
    const result = await parsers.withSyntaxTree(
      'python',
      'def f():\n    return 1\n',
      (root) => root.namedChildren[0]?.type,
    );
    expect(result.value).toBe('function_definition');
    expect(result.warnings).toEqual([]);
  });

  it('tolerates error-recovery nodes: a tree is still produced, and reported', async () => {
    const parsers = createTreeSitterParsers();
    const result = await parsers.withSyntaxTree(
      'python',
      'def (:\nclass 3:\n',
      (root) => root.hasError,
    );
    expect(result.value).toBe(true);
    expect(result.warnings.join(' ')).toContain('parsed with error recovery');
  });

  it('turns a missing grammar into a warning instead of a throw', async () => {
    const parsers = createTreeSitterParsers(() => Promise.reject(new Error('no such wasm')));
    const result = await parsers.withSyntaxTree('java', 'class A {}', (root) => root.type);
    expect(result.value).toBeUndefined();
    expect(result.warnings).toEqual(["tree-sitter grammar 'java' unavailable: no such wasm"]);
  });

  // The roster spans two packages (ADR-0014): `tree-sitter-wasms` for python/java/html and
  // `@tree-sitter-grammars/tree-sitter-hcl` for terraform. This is the test that proves the
  // `GrammarSource` indirection actually resolves both, on the pinned web-tree-sitter version.
  it('loads every grammar the roster claims to ship', async () => {
    const parsers = createTreeSitterParsers();
    for (const grammarId of TREE_SITTER_GRAMMARS) {
      const result = await parsers.withSyntaxTree(grammarId, '', (root) => root.type);
      expect(result.value, `grammar '${grammarId}' failed to load`).toBeDefined();
    }
  }, 20_000);
});
