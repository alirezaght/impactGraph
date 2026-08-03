# ADR-0012: Effective-LOC Enforcement (300 Effective Lines per File)

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

This is a decision about how we build ImpactGraph, not a product feature. The codebase will be
written largely by AI agents under human review. Agents drift toward god-files: a use case that
absorbs its port, its mapper, and its validation until no boundary is visible. Small files are the
cheapest structural forcing function we have — they make the ports-and-adapters split (ADR-0004)
physically necessary and keep every file reviewable in one sitting. The provenance model
(ADR-0002) in particular dies in god-files, where fact-handling and inference-handling code merge.
The question is how to enforce a size limit so it changes design rather than formatting.

## Options Considered

### Option A — Naive `wc -l` limit (rejected)

- Pros: trivial to implement; zero dependencies; instantly understood.
- Cons: counts blank lines, comments, and license headers — so it **punishes documentation and
  rewards deleting comments**, the exact opposite of the intent; trivially gamed in the other
  direction by joining statements onto long lines; a well-commented 250-line module fails while a
  comment-stripped 299-line monster passes. Measures the wrong thing.

### Option B — Cyclomatic/cognitive-complexity limits instead of size

- Pros: measures something closer to real cost; existing ESLint rules.
- Cons: complexity metrics are per-function, not per-file — a file of forty simple functions passes
  every complexity rule while being an unreviewable grab-bag; thresholds are contested and noisy;
  does not produce the file-granularity modularity we are optimizing for. Useful as a complement,
  not the gate.

### Option C — Tokenizer-based effective-LOC with reviewed, expiring exceptions (chosen)

Count **effective lines**: lines containing at least one code token, as reported by the TypeScript
scanner — comments, blank lines, and lone delimiters do not count. Limit: **300 effective lines
per source file** by default.

- Pros: measures code, not prose — commenting is free, so documentation is never penalized;
  scanner-based counting is exact (no regex heuristics for template literals or JSX); the same
  scanner underpins anti-gaming checks; one number is predictable for authors and agents alike.
- Cons: "effective" is less obvious than `wc -l` — the checker must explain its count
  (`quality:loc --explain <file>`); a hard number is arbitrary at the margin and some cohesive
  files (large Zod schema modules, generated unions) legitimately exceed it; tokenizer-based
  tooling is ours to maintain (`scripts/quality/effective-loc/`).

## Decision

Option C, wired as follows:

1. **Limit**: 300 effective lines per source file, enforced by `pnpm quality:loc` (tokenizer:
   TypeScript scanner), run in pre-commit on staged files, in `quality:gates`, and as the dedicated
   `effective-loc` CI job.
2. **Exceptions are reviewed and expire**: a file may exceed the limit only via an entry in the
   exception file, created from `.claude/templates/loc-exception.md`, naming the file, the reason,
   the approving human, and an **expiry date**. Expired exceptions fail the gate. Exceptions are
   for genuinely cohesive files (e.g. a generated contract union), never for "no time to split".
3. **Anti-gaming lint rules** ship alongside the counter: `max-len` (so code cannot hide in long
   lines), `max-statements-per-line`, and a ban on meaning-free file splits being used to dodge
   review (`part2.ts` naming is a review flag, and re-exported god-modules are caught by the
   boundaries rules of ADR-0004). The counter counts token-bearing lines precisely so that neither
   comment-stripping nor line-joining changes the answer materially.
4. The checker has its own test suite (`test:quality` — these tests exist from day one).

## Consequences

- Positive: modularity pressure is continuous and automatic rather than a review argument; every
  file stays within one review pass; agents get an unambiguous, machine-checkable constraint;
  documentation is cost-free by construction.
- Negative: some natural modules must split at seams chosen under pressure — occasionally the split
  is worse than the monolith and the exception process must be used without shame; the tool itself
  is code we maintain and test; the 300 number will be argued — this ADR is the place that argument
  ends.

## Revisit Trigger

If the exception file grows past ~10 concurrent entries or exceptions are being renewed rather than
resolved, the limit or the counting rules are wrong for this codebase — revisit the number and the
splitting guidance in docs/engineering/effective-loc-policy.md before weakening enforcement.

## Links

- Related: ADR-0002 (why god-files are dangerous here), ADR-0003 (TypeScript scanner availability),
  ADR-0004 (the structure this metric protects)
- docs/engineering/effective-loc-policy.md, docs/engineering/quality-gates.md,
  .claude/templates/loc-exception.md
