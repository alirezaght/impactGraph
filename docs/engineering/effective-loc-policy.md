# Effective LOC Policy

Every source file stays at or under **300 effective lines**. Decision record: ADR-0012
(`docs/adr/0012-effective-loc-enforcement.md`). Gate: `pnpm quality:loc`, enforced in pre-commit
(staged files), the dedicated `effective-loc` CI job, and `pnpm quality:gates`
(see `quality-gates.md`). Checker tests live in the `quality` vitest project
(`pnpm test:quality`, `scripts/quality/**`).

## 1. What counts as effective

A line is **not** effective if it is any of:

- blank
- comment-only (line or block continuation)
- doc comment (`/** … */` lines)
- import-only (`import …` / `export … from …` re-export lines)
- pure type re-export (`export type { X } from './x'`)
- punctuation-only (`}`, `);`, `],` and similar closers)

Everything else — statements, expressions, declarations, type bodies, JSX — is effective. The
classification is done by a **tokenizer built on the TypeScript compiler's scanner**, never by
regexes and never by raw `wc -l`: string literals containing `//`, template literals, and JSX text
are classified correctly because the scanner, not a pattern, decides what a token is.

## 2. Why 300

- **Reviewability**: a reviewer (human or agent) can hold one file's behavior in their head; PRs
  stay reviewable because no single file dominates them.
- **Single responsibility**: files that grow past ~300 effective lines almost always hold more
  than one responsibility. The limit is a forcing function for the module boundaries in
  `architecture.md` and `dependency-rules.md`, and it keeps files inside AI-agent context windows
  without truncation.

The count excludes non-effective lines precisely so the limit never punishes documentation,
imports, or formatting — only logic density.

## 3. The checker CLI

```
pnpm quality:loc                       # whole repo (respects ignore config)
pnpm quality:loc --files a.ts b.tsx    # only these files (used by pre-commit on staged files)
pnpm quality:loc --json                # machine-readable report (per-file counts, violations,
                                       # applied/expired exceptions)
```

Implementation: `tsx scripts/quality/effective-loc/src/cli.ts` (the `quality:loc` root script).

Exit codes:

| Code | Meaning                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0    | All files within limits (including files covered by valid exceptions)                                                             |
| 1    | One or more violations — over the limit with no exception, over an exception's `maxLines`, or covered by an **expired** exception |
| 2    | Usage or internal error (bad flags, unreadable file, tokenizer failure)                                                           |

## 4. Exception process

Exceptions are rare, reviewed, and expiring — never a loophole.

1. Fill `.claude/templates/loc-exception.md`: why the file cannot be split _yet_, what the split
   plan is, who owns it.
2. Add an entry to `scripts/quality/loc-exceptions.json`:

```json
{
  "path": "packages/repository-intelligence/src/indexer.ts",
  "reason": "Index pipeline pending split into scan/parse/persist stages (backlog epic ref)",
  "owner": "repository-intelligence",
  "reviewBy": "2026-10-31",
  "maxLines": 380
}
```

3. **Human approval is required** (CLAUDE.md mandatory-approval list) before the entry lands.
4. On `reviewBy` expiry the exception **fails the build** (exit 1) — expired means renegotiate
   with a human or split the file; it never silently keeps working. Renewal is a new review, and
   repeated renewal of the same file is a signal the split must happen now.

`maxLines` caps the exception: the file may exceed 300 but never the approved ceiling.

## 5. Anti-gaming rule

Compressing code to dodge the counter is a lint failure, not a win: ESLint `complexity`,
`max-statements`, and function-size rules (see `quality-gates.md` §1, lint gate) catch dense
one-liners, mega-ternaries, and statement-chaining. Joining lines does not reduce complexity — it
just hides it from one metric while another catches it.

**The only sanctioned fix is splitting by responsibility**: extract a cohesive unit (a policy, a
mapper, a sub-pipeline stage) into its own file with its own tests, following the module ownership
in `bounded-contexts.md`. Do not shard mechanically (`indexer1.ts`, `indexer2.ts`) — the ESLint
boundary rules and code review reject responsibility-free splits.

## 6. Extending to more languages

The checker separates counting from classification:

- The CLI walks files, applies exceptions, and reports — language-agnostic.
- A **per-language tokenizer** implements the classification interface (given file text, yield
  line classifications per §1). The TypeScript scanner tokenizer is the first implementation and
  covers `.ts`/`.tsx`/`.mts`/`.cts` (and `.js` variants).

Adding a language later (e.g. Python fixtures tooling) means: implement the tokenizer interface
for that language, register it by file extension, add classification tests in the `quality`
vitest project, and document the effective-line rules for that language here. Files with no
registered tokenizer are skipped and reported as unchecked — never silently counted with the
wrong rules.

## 7. Relationship to other gates

LOC is one leg of the reviewability tripod: LOC (file size), lint complexity rules (density), and
dependency boundaries (`dependency-rules.md`, coupling). Passing LOC while failing the others is
still a failing build — see the no-weakening rule in `quality-gates.md` §4.
