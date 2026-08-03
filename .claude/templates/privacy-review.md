# Privacy Review: <change or feature name>

_Complete for any change to data flow, privacy modes, redaction, SecretStorage, logging, telemetry,
or artifact contents (PRD §9, §35, §36, §42.5). Run via `/review-privacy`; verdict requires the
ai-inference-privacy agent's checklist plus human approval (CLAUDE.md)._

- **Change under review:** <PR / plan link>
- **Reviewer / date:** <name> / <YYYY-MM-DD>

## What data flows where

_Every data movement this change introduces or alters. "Nothing leaves the machine" must be
demonstrated, not asserted._

| Data                 | From      | To           | Trigger                   | User-visible?    |
| -------------------- | --------- | ------------ | ------------------------- | ---------------- |
| <e.g. code snippets> | <indexer> | <provider X> | <explicit analyze action> | <prompt preview> |

## Privacy-mode behavior matrix (PRD §9)

| Mode                        | Behavior of this feature                                            | Verified how             |
| --------------------------- | ------------------------------------------------------------------- | ------------------------ |
| local-only                  | <no network activity — must be provable>                            | <test / code inspection> |
| selected-snippets (default) | <only minimized ranges sent>                                        | <...>                    |
| full-context                | <...>                                                               | <...>                    |
| external-agent              | <no provider call by us; data exported via MCP/context export only> | <...>                    |

## Checklist (PRD §35)

- [ ] No secrets can reach model prompts (redaction test passes: `test:unit`/`analyzers` case <name>)
- [ ] `.env` and environment files excluded by default; exclusion covers this new path
- [ ] Common secret patterns redacted in any new outbound or persisted text
- [ ] API keys/credentials only in VS Code SecretStorage; nothing credential-like committed or in artifacts
- [ ] Prompt preview shows exactly what this change sends (byte-accurate, not a summary)
- [ ] Consent points: external send requires explicit configuration + user action; no mode changed silently
- [ ] Logging: no raw secrets, no full source files, no snippet contents in logs (logging port only)
- [ ] Telemetry: remains off by default; this change adds <no telemetry | opt-in events: <list>>
- [ ] Artifact contents: new/changed artifacts contain <no source beyond evidence ranges | describe>;
      artifacts safe to commit/share within stated expectations
- [ ] Workspace trust respected; repository content handled as untrusted (prompt-injection case in test plan, PRD §42.5)
- [ ] External requests inspectable (audit log entry written per outbound call)

## Findings

_Anything that fails or is ambiguous above. Empty findings with unchecked boxes is an invalid review._

1. <finding — severity: blocker | must-fix | note>

## Verdict

- [ ] **Pass** — no privacy posture change, or changes fully mitigated
- [ ] **Pass with required changes:** <list — re-review needed? y/n>
- [ ] **Fail** — blockers: <list>

Human approver (mandatory for privacy-affecting changes): <name / date>
