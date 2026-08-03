import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// ADR-0008 — tree-sitter grammars ship as WebAssembly: no native builds, no toolchain on the
// user's machine, and the same bytes everywhere (ADR-0006/0007 no-native-builds lean).
//
// Grammars do NOT all come from one package. `tree-sitter-wasms` is a bundle of many grammars;
// `@tree-sitter-grammars/tree-sitter-hcl` is a single-purpose package that ships two artifacts
// (ADR-0014). `GrammarSource` absorbs that difference: a grammar id names a language, never a
// package, and the mapping from id to artifact lives here alone.
//
// Only grammars that actually resolve are listed — `src/tree-sitter/parsers.test.ts` loads every
// id in this roster, so a speculative entry fails the analyzers suite rather than a user's index.

export const TREE_SITTER_GRAMMARS = ['python', 'java', 'html', 'json', 'terraform'] as const;

export type GrammarId = (typeof TREE_SITTER_GRAMMARS)[number];

/**
 * Package specifier of each grammar's compiled `.wasm`.
 *
 * `terraform` deliberately points at `tree-sitter-terraform.wasm` and not the `tree-sitter-hcl.wasm`
 * that ships beside it: the Terraform dialect carries `resource`/`module`/`provider` semantics,
 * which is the surface PRD §15.2 actually names (ADR-0014 consequences).
 */
const WASM_SPECIFIER: Readonly<Record<GrammarId, string>> = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  java: 'tree-sitter-wasms/out/tree-sitter-java.wasm',
  html: 'tree-sitter-wasms/out/tree-sitter-html.wasm',
  json: 'tree-sitter-wasms/out/tree-sitter-json.wasm',
  terraform: '@tree-sitter-grammars/tree-sitter-hcl/tree-sitter-terraform.wasm',
};

/**
 * Supplies the compiled bytes of one grammar. Injectable so a bundled host (the VS Code
 * extension, whose bundler does not copy `node_modules` around) can hand over bytes it shipped
 * itself instead of resolving a package path at runtime. See docs/engineering/language-adapters.md.
 */
export type GrammarSource = (grammarId: GrammarId) => Promise<Uint8Array>;

/**
 * Default source: resolve the `.wasm` inside the installed grammar package and read it as bytes.
 * Resolution is by package specifier (not a path relative to this file), so it works from source,
 * from a compiled `dist/`, and under pnpm's symlinked layout alike. Bytes rather than a path are
 * handed to tree-sitter so no loader ever needs filesystem access of its own.
 */
export const nodeGrammarSource: GrammarSource = async (grammarId) => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve(WASM_SPECIFIER[grammarId]);
  return new Uint8Array(await readFile(wasmPath));
};
