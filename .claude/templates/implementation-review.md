# Dev Integration Review: <change name>

_OUR review of a completed change against its plan — distinct from the product's Implementation
Review feature (PRD §24), which reviews the user's code against an approved impact model. Do not
confuse the two (see docs/engineering/bounded-contexts.md). Usually produced at the end of
`/develop-feature` or by `/architecture-review`._

- **Plan reviewed against:** <feature-plan link>
- **Diff / branch:** <link or `git diff` ref>
- **Reviewer / date:** <agent + human> / <YYYY-MM-DD>

## Plan vs diff

| Plan item                                          | Status                                | Notes |
| -------------------------------------------------- | ------------------------------------- | ----- |
| <affected package / contract / test from the plan> | done \| partial \| dropped \| changed | <...> |

## Unexpected changes

_Everything in the diff that the plan did not predict. Each needs a verdict._

| Change          | Why it happened | Verdict                                                        |
| --------------- | --------------- | -------------------------------------------------------------- |
| <file/behavior> | <...>           | accepted (plan updated) \| revert \| follow-up: <backlog link> |

## Boundary violations (docs/engineering/dependency-rules.md)

- ESLint boundaries clean: <yes — `pnpm lint` output attached below | violations: <list>>
- Manual check for what lint can't see (domain logic in shells, webview deciding, DTOs leaking
  into domain): <clean | findings>

## Provenance audit result (`/review-provenance` — required if knowledge records changed)

- <not applicable — no knowledge records touched> | result: <pass | findings: category mixing /
  missing evidence IDs / mutation of superseded records / model-authored confidence>

## Contract audit result (`/review-contracts` — required if any boundary schema changed)

- <not applicable> | result: <pass | findings — version bumps correct, both-end validation present,
  templates (command-contract / webview-message-contract / persistence-schema-change) completed>

## Privacy audit result (`/review-privacy` — required if data flow changed)

- <not applicable> | privacy-review.md verdict: <pass | pass-with-changes | fail> — <link>

## Test evidence

- `pnpm quality:gates`: <green — paste summary line>
- Additional suites run (`test:analyzers`, `test:webview`, `test:integration:vscode`): <results>
- Golden files changed: <none | list with reason each>
- Skipped tests / `.only`: <none — verified>

## Docs updated

- docs/engineering pages: <list | none needed because <...>>
- ADR: <created/updated ADR-<NNNN> | none needed>
- Changeset added: <yes/no/n-a>

## Open discrepancies and owners

| #   | Discrepancy | Severity                    | Owner        | Due / backlog link |
| --- | ----------- | --------------------------- | ------------ | ------------------ |
| 1   | <...>       | blocker \| must-fix \| note | <name/agent> | <...>              |

## Outcome

- [ ] Ready for PR (all blockers resolved, mandatory human approvals identified in the PR template)
- [ ] Rework needed: <summary>
