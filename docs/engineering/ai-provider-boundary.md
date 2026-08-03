# AI Provider Boundary

How ImpactGraph talks to AI models without depending on any of them. Decision record: ADR-0010
(`docs/adr/0010-ai-provider-abstraction.md`). Owning agent: `ai-inference-privacy`. Specialist
skill: `ai-inference-safety`. Privacy behavior is specified in
`docs/engineering/privacy-and-security.md`; provenance rules in `provenance-model.md`.

## 1. The port (PRD §8)

The `ModelProvider` port lives in `packages/application` (ports side). PRD §8 defines it:

```ts
interface ModelProvider {
  generateStructuredOutput<T>(request: ModelRequest, schema: JsonSchema): Promise<ModelResponse<T>>;
}
```

Everything AI-related in use cases goes through this one interface. Use cases never know which
provider is configured, never see SDK types, and never construct provider-specific payloads.
`ModelRequest` carries the prompt sections, the privacy-mode-filtered evidence, and the context
budget; `ModelResponse<T>` carries the parsed candidate output plus provider/model metadata.

## 2. Provider strategies (PRD §8)

| Strategy             | What it means                                                                                | Network calls by ImpactGraph                       |
| -------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| External agent       | Claude Code / Cursor / any MCP client invokes ImpactGraph tools and does its own model calls | None — no `ModelProvider` is instantiated          |
| User-configured API  | User configures a provider + key (SecretStorage)                                             | Yes, after prompt preview/consent per privacy mode |
| Local model endpoint | User points at a local inference server                                                      | Localhost only                                     |
| None                 | Deterministic analysis only                                                                  | None                                               |

ImpactGraph must remain useful with no provider at all (PRD §8): indexing, graph, deterministic
impact candidates, review, and export all work; only requirement interpretation is limited.
`external-agent` privacy mode (PRD §9.4) means ImpactGraph itself sends nothing externally.

## 3. What lives in `packages/ai-inference`

- `packages/ai-inference/providers/*` — one directory per provider adapter. **Provider SDK types
  are quarantined here**: importing an AI SDK anywhere else is an ESLint-boundaries violation
  (see `dependency-rules.md`). Each adapter maps SDK request/response types to the port types at
  this boundary and nowhere else.
- Prompt construction, evidence selection, redaction invocation, context budgeting, response
  validation pipeline, retry policy, and failure taxonomy — the provider-independent machinery
  around the port.
- No domain logic: interpretation results are handed back to `packages/application` use cases,
  which decide what becomes an `llm-inferred` record.

## 4. Prompt construction and context budgeting

- Prompts are assembled from typed sections (specification text, architecture metadata, symbol
  signatures, selected source ranges, dependency paths) — the allowed evidence set is determined
  by the active privacy mode (PRD §9.2); `local-only` and `external-agent` build no external
  prompt at all.
- Every prompt passes secret redaction and `.env` exclusion before it can leave the process
  (PRD §35); the prompt preview shown to the user is the exact final payload.
- Repository content embedded in prompts is **untrusted data** (PRD §42.5): it is delimited as
  data, never concatenated into instruction sections, and instruction text never comes from the
  repository.
- Context budget: each request declares a token budget (see `performance-budgets.md`); evidence
  selection ranks by confidence signals and truncates deterministically. Truncation is recorded in
  the analysis run so results are explainable.

## 5. Structured output validation pipeline

Every provider response goes through, in order:

1. **Zod parse** against the response schema in `packages/contracts` (JSON Schema exported for the
   request, Zod on the response). Parse failure → typed `InvalidModelOutput` error, retried per §6.
2. **Node-reference validation**: every node/edge/component the output references must exist in
   the deterministic Repository Knowledge Graph. References to nonexistent nodes are rejected
   (PRD §34).
3. **Downgrade of unsupported claims** (PRD §34, §43.2): claims without evidence IDs backing them
   are kept but downgraded — marked unsupported with reduced confidence — never deleted, never
   promoted to fact, never silently dropped.
4. **Provenance stamping**: surviving records get `llm-inferred` provenance, evidence IDs,
   snapshot/run IDs, and provider metadata (§8 below).

AI output can only ever _reference_ the deterministic graph; it can never create deterministic
facts or overwrite `human-confirmed` records (append-only supersession — ADR-0002).

## 6. Confidence rules (PRD §14)

Confidence is **never a number the provider authored**. It is computed from weighted deterministic
signals (exact/semantic concept match, direct import/call/data access, API ownership, event
relationship, shared bounded context, framework convention, historical co-change, test
association, human-confirmed mapping, graph distance; negative signals: ambiguity, conflicting
evidence, unsupported inference). The contributing signals are stored with the score so the UI can
answer "why 0.88?". A provider-supplied self-assessment may at most be one weak signal, clearly
labeled — the `domain-provenance` agent reviews any change to signal weights.

## 7. Retry and failure taxonomy

Typed failures (no throwing strings — see the main skill §7):

| Failure                         | Retry?                                        | Effect                                                |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Transport/timeout               | Bounded retry with backoff, cancellable       | Analysis continues without AI enrichment if exhausted |
| Rate limit                      | Retry after provider hint, cancellable        | Same                                                  |
| `InvalidModelOutput` (Zod fail) | One re-prompt with validation errors attached | Then degrade                                          |
| Node-reference rejection        | No retry — pipeline downgrades/rejects claims | Deterministic results unaffected                      |
| Auth/config error               | No retry                                      | Surfaced with fix guidance; no silent mode change     |

**Invariant (PRD §34, CLAUDE.md rule 7): AI failure degrades AI features only.** Indexing, graph,
review, and the extension stay fully usable. Provider failures are logged without source code or
prompt contents (PRD §34, §35).

## 8. Provider and model metadata

Every `llm-inferred` record stores: provider ID, model name/version as reported, request timestamp,
privacy mode in force, prompt-template version, and truncation/budget info. This makes provider
inconsistency (PRD §43.5) auditable: two runs with different models are distinguishable artifacts,
never merged.

## 9. Adding a new provider

1. Fill `.claude/templates/ai-inference-contract.md` (request/response shapes, redaction points,
   metadata mapping, failure mapping into §7's taxonomy).
2. Implement the adapter under `packages/ai-inference/providers/<name>/` only; map SDK types at
   the edge; keys via SecretStorage port only.
3. Contract tests in the `contract` vitest project for the response schemas; adapter tests with
   recorded/faked responses in `analyzers` (no live network in CI).
4. Run `/review-privacy` (data-flow change) and `/review-contracts` (typed boundary), then
   `pnpm quality:gates`.
5. Human approval is mandatory — new dependency + external data flow (CLAUDE.md approval list).

New provider _strategies_ (beyond the four in §2) require an ADR via `/create-adr` — see
`adr-process.md`.
