# AI Inference Contract: <inference task name>

_For every task sent through the ModelProvider port (`generateStructuredOutput<T>`, ADR-0010).
Lives in packages/ai-inference; reviewed by the ai-inference-privacy agent with the
ai-inference-safety skill via `/review-privacy`. AI output is interpretation, never fact._

- **Task name:** <e.g. `concept-to-node-matching`, `architectural-alternatives`>
- **PRD grounding:** §<n> (e.g. §13, §26); epic backlog/epic-<NN>-<name>.md
- **Author / date:** <name> / <YYYY-MM-DD>

## Candidate-set construction (deterministic pre-filter)

_AI never sees or names the whole graph. Which deterministic query builds the candidate nodes,
and what caps apply?_

- Query: <e.g. "graph neighborhood ≤ N hops from concept-matched symbols, capped at <k> nodes">
- Cap and ranking when over cap: <...>

## Prompt inputs (exact context, respecting privacy mode — PRD §9)

| Input                               | Included in local-only          | selected-snippets | full-context | external-agent                                   |
| ----------------------------------- | ------------------------------- | ----------------- | ------------ | ------------------------------------------------ |
| <candidate node IDs + labels>       | task unavailable offline? <y/n> | <...>             | <...>        | n/a — no provider call; context exported instead |
| <source snippets, ranges minimized> | —                               | <...>             | <...>        | —                                                |

_Repository content in prompts is untrusted data — delimited and instructed as data, never as
instructions (PRD §42.5)._

## Redaction applied (PRD §35)

- Secret-pattern redaction: <yes — via <shared redaction module>>
- `.env` and env-file exclusion: <confirmed>
- Source-range minimization: <how snippets are trimmed>
- Prompt preview available before send: <confirmed — surface: <...>>

## Output Zod schema

```ts
const <Task>Output = z.object({
  schemaVersion: z.literal(<n>),
  items: z.array(z.object({
    nodeId: z.string(),           // must exist in the deterministic graph
    evidenceIds: z.array(z.string()).min(<n>),
    explanation: z.string(),
    // never: confidence authored by the model
  })),
});
```

## Evidence-citation requirement

- Every claim must cite ≥ <n> evidence IDs from the provided candidate context
- Claims with no valid evidence: downgraded to <e.g. `possible` with warning> — never deleted,
  never promoted (PRD §34, §41.3)

## Node-reference validation

- After parse: every `nodeId` checked against the deterministic graph at the referenced
  repositorySnapshotId; unknown references <rejected item-wise with AnalysisWarning>
- Whole-response schema failure: <retry once with error feedback | fall back per below>

## Confidence handling (PRD §14)

- Confidence computed from weighted deterministic signals (<list signals used>) — the model never
  authors the number; contributing signals stored with the score

## Provider metadata recorded

- On every resulting record: provider ID, model ID, prompt/template version <n>, timestamp,
  privacy mode, analysis-run ID (provenance = `llm-inferred`)

## Failure / fallback behavior

- Provider unavailable / timeout / repeated invalid output: <feature degrades to <deterministic
  result / unavailable-with-reason>> — indexing, review, and the extension remain fully usable
  (CLAUDE.md rule 7)

## Token / context budget

- Max input tokens: <n> (candidate cap above enforces this); max output tokens: <n>
- Over-budget behavior: <shrink candidate set by ranking, warn — never silently truncate snippets
  mid-secret-redaction>
