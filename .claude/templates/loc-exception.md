# Effective-LOC Exception Request: <file path>

_Policy: ≤ 300 effective lines per source file (ADR-0012, docs/engineering/effective-loc-policy.md).
Approved exceptions live in `scripts/quality/loc-exceptions.json`; this document is the request and
review record. Exceptions require human approval and expire. Never compress lines to game the
metric — split by responsibility instead._

- **File path:** <absolute-from-repo-root, e.g. packages/repository-intelligence/src/indexer/…>
- **Current effective LOC:** <n> (`pnpm quality:loc --files <path>` output)
- **Requested max:** <n — the smallest number that works, not a round comfortable one>
- **Requested by / date:** <name or agent> / <YYYY-MM-DD>

## Reason: why splitting harms the design

_The bar is "splitting makes the code worse", not "splitting is effort". Be specific._

_TBD — e.g. "exhaustive switch over all 27 edge types (PRD §12.2); splitting breaks the
compiler-enforced exhaustiveness that is the point of the file">

## Decomposition alternatives considered

_Each alternative and the concrete harm it causes. "Would create a utils file" is a rejected
alternative done right — say so explicitly._

1. <split by <axis>>: rejected because <...>
2. <extract <part> to <package/module>>: rejected because <...>

## Scope of exception

- Applies to: <this file only — exceptions are never directory-wide>
- Expected trajectory: <shrinks when <event> | stable | grows — if grows, why is that acceptable?>

## Ownership and expiry

- **Owner:** <human name — owns re-review>
- **Review / expiry date:** <YYYY-MM-DD, ≤ 6 months out> — on expiry the entry is removed from
  `loc-exceptions.json` unless re-approved with a fresh version of this document

## Approval

- **Approver:** <human name> — approved / rejected on <YYYY-MM-DD>
- JSON entry added (path, reason, owner, review date, approved max): <commit sha>
