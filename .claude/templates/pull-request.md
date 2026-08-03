# <Conventional-Commit-style title, e.g. feat(impact-engine): add dependency-path traversal>

## Summary

_Two or three sentences: what changed and why, in product language._

_TBD_

## Links

- PRD: §<n> / §<Zn> / §<Cn>
- Epic / stories: backlog/epic-<NN>-<name>.md
- Feature plan: <link> · ADR(s): <ADR-NNNN | none>
- Dev integration review: <link to completed implementation-review.md | inline below>

## Changes by package

| Package / app  | Change |
| -------------- | ------ |
| packages/<...> | <...>  |

## Knowledge-category / provenance impact (PRD §3, §12.3)

<none — no knowledge records touched> | <records affected, categories, supersession/staleness
behavior; `/review-provenance` result: <pass>>

## Contract changes and version bumps

<none> | <contract area (webview/tools/cli/artifacts/config), version <old>→<new>, additive or
breaking, template link; `/review-contracts` result: <pass>>

## Privacy impact (PRD §9, §35)

<none — data flow unchanged, verified> | <privacy-review.md verdict + link>

## Performance impact (PRD §33)

<no budgeted path touched> | <performance-budget.md numbers: baseline → post-change, within budget>

## Test evidence

_Exact commands and results — reviewers should not have to re-derive this._

```
pnpm quality:gates      → <pass, duration>
pnpm test:analyzers     → <pass / n-a>
pnpm test:webview       → <pass / n-a>
pnpm test:integration:vscode → <pass / n-a>
```

- New tests: <count per project>; golden files changed: <none | list + reason>

## Docs / ADR updates

- <docs/engineering/<page>.md updated | none needed because <...>>
- Changeset: <added (<patch|minor|major>) | n/a pre-release>

## LOC exceptions touched

<none> | <scripts/quality/loc-exceptions.json entries added/modified — loc-exception.md link each>

## Human-approval items (CLAUDE.md mandatory list)

- [ ] <item> — approver: <name> | ☐ none apply (verified against the list)

## Checklist

- [ ] Branch `feat/…`/`fix/…`/`chore/…`; commits are Conventional Commits
- [ ] `pnpm quality:gates` green locally; CI fully green including slow lanes
- [ ] No skipped tests without written reason; no `.only`; no TODOs without backlog links
- [ ] Knowledge-category separation intact (no mixing added anywhere in this diff)
- [ ] All boundary data Zod-validated with schemaVersion
- [ ] Secrets scan clean; no source code or secrets in logs added by this change
