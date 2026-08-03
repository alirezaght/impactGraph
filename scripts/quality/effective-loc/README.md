# Effective-LOC checker

Enforces the 300-effective-line file limit (ADR-0012,
`docs/engineering/effective-loc-policy.md`). Runs as `pnpm quality:loc`
(= `tsx scripts/quality/effective-loc/src/cli.ts`), in the pre-commit hook via
`--files <staged>`, and in the dedicated `effective-loc` CI job.

## Usage

```
pnpm quality:loc                          # scan apps/, packages/, scripts/
pnpm quality:loc --files a.ts b.tsx       # check only these files (lint-staged)
pnpm quality:loc --json                   # stable machine-readable report
```

Each violation prints one line, sorted by path, followed by a summary:

```
apps/cli/src/main.ts  effective=412  max=300
effective-loc: 1 violation(s), 57 file(s) checked
```

Exit codes: `0` clean · `1` violations, or expired/invalid exception entries ·
`2` usage or config errors (unknown flag, missing `--files` target, unreadable
exceptions file).

## How counting works

Counting is tokenizer-based, not regex-based: the file is parsed with the
TypeScript compiler (`ts.createSourceFile`), the AST is walked to its leaf
tokens, and each token is mapped to the source lines it spans
(`src/analyzer.ts`). A line is **effective** when it carries at least one real
code token.

Excluded lines:

| Excluded                                                                       | Why                                   |
| ------------------------------------------------------------------------------ | ------------------------------------- |
| Blank lines                                                                    | no tokens                             |
| Comment-only lines (line, block, JSDoc)                                        | comments are trivia, not tokens       |
| `import` declaration lines (incl. multi-line imports)                          | tokens belong to an ImportDeclaration |
| `export type {...} from`, `export * from '...'`, type-only `export {...} from` | pure re-exports                       |
| Lines whose only tokens are `{ } ( ) [ ] ; ,`                                  | punctuation carries no logic          |
| Shebang line                                                                   | trivia                                |

Still counted: mixed code + trailing comment lines, template-literal and string
lines containing `//` or `/*` (they are single tokens — never mistaken for
comments), JSX text, decorator lines, value re-exports (`export { x } from`).
Ordinary test files are **deliberately** subject to the limit; only generated
output and the fixture directories are ignored (see `src/config.ts`).

## Exception process

Exceptions live in `scripts/quality/loc-exceptions.json` (validated against
`loc-exceptions.schema.json` in editors and by Zod at runtime). Every entry
requires `path`, `reason`, `owner`, `reviewBy` (YYYY-MM-DD expiry), and
`maxLines`. The check **fails** when an entry is expired, references a missing
file, is duplicated, or does not match the schema — exceptions cannot rot
silently. Propose one with `.claude/templates/loc-exception.md`; approval is
mandatory (see `.claude/CLAUDE.md`, "When human approval is mandatory").

## Adding a language analyzer

`src/analyzer.ts` defines the seam:

```ts
interface EffectiveLocAnalyzer {
  readonly id: string;
  supports(filePath: string): boolean;
  analyze(fileName: string, sourceText: string): EffectiveLocResult;
}
```

1. Implement the interface for the new language (e.g. tree-sitter-based for
   Python, mirroring ADR-0008's parser strategy). Produce the same
   `EffectiveLocResult` shape, including per-line classifications.
2. Register it: `defaultRegistry.register(pythonAnalyzer)` next to the
   TypeScript registration at the bottom of `analyzer.ts`. The first analyzer
   whose `supports()` accepts a path wins; the CLI silently skips files no
   analyzer supports.
3. Extend `includeGlobs` in `src/config.ts` with the new extensions.
4. Add fixtures with hand-verified expected counts and tests asserting them
   (see `tests/cli.test.ts`, `EXPECTED_EFFECTIVE`).

## Layout

```
src/analyzer.ts     token-based counting + analyzer registry (the seam)
src/config.ts       limits, include/ignore globs, glob matcher
src/exceptions.ts   Zod schema + validating loader for loc-exceptions.json
src/report.ts       deterministic text/JSON reports
src/cli.ts          argument parsing, file discovery, exit codes; exports run()
tests/              vitest suites (vitest project: quality → pnpm test:quality)
fixtures/           analyzer fixtures with known expected counts (ignored by the scan)
```
