---
name: impact-model-development
description: Use when building or changing the impact engine — concept-to-node matching, deterministic candidate traversal, impact classification, likelihood/impactType/directness taxonomy, evidence validation, confidence scoring, accept/reject/manual-add decisions, analysis approval and versioning, or architectural options.
---

# Impact Model Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill covers the impact half of the Impact & Review Engine (PRD §C15.3): `ImpactAnalysis`
types in `packages/domain`, the pipeline use cases in `packages/application`, graph access and AI
classification through ports. Owned by the `impact-modeling` agent (review comparison belongs to
`implementation-review-development`).

## Purpose

Answer "what will this feature affect, and why?" with impacts that always reference a real
repository node, always carry evidence and a dependency path, and always show a confidence the
user can interrogate (PRD §13, §14, §40.3). This is the pipeline of backlog Epic F.

## When to use

- Concept extraction/matching, candidate graph traversal, impact classification, dependency
  paths, ambiguity penalties.
- Evidence validation, confidence engine, warnings.
- User decisions (accept/reject/manual-add), analysis approval, versioning.
- Architectural option generation (PRD §26) and its selection workflow.

## When NOT to use

- Requirement extraction or clarification questions (→ `specification-analysis-development`).
- Diff comparison after implementation (→ `implementation-review-development`).
- Prompt/redaction/provider mechanics (→ `ai-inference-safety`) — this skill defines _what_ the
  model is asked to classify, that one defines _how_ it is asked.

## Required context

1. PRD §13 (impact model — shape below), §14 (confidence model), §26 (architectural
   alternatives), §40.3 (acceptance criteria), §43.2/§43.5 (hallucination & provider-inconsistency
   mitigations), §46 (first milestone output).
2. `docs/engineering/provenance-model.md`; `domain-provenance-development` for the record types
   this engine produces.

## The shape (PRD §13.1 — implement exactly)

```ts
interface RequirementImpact {
  requirementId: string;
  nodeId: string;
  likelihood: 'required' | 'likely' | 'possible' | 'unlikely';
  impactType:
    | 'domain-model'
    | 'business-rule'
    | 'api-contract'
    | 'data-model'
    | 'migration'
    | 'event-contract'
    | 'read-model'
    | 'background-processing'
    | 'integration'
    | 'security'
    | 'observability'
    | 'performance'
    | 'infrastructure'
    | 'deployment'
    | 'testing'
    | 'documentation';
  directness: 'direct' | 'indirect';
  confidence: number;
  explanation: string;
  expectedChanges: string[];
  evidenceIds: string[];
  dependencyPath: string[];
  provenance: Provenance;
}
```

`ImpactAnalysis` binds impacts to `specificationId` + `specificationVersion` +
`repositorySnapshotId` with `status: draft | reviewed | approved | superseded`, plus
`architecturalOptions`, `warnings`, and `userDecisions` (PRD §13).

## Architectural rules

- **Deterministic candidates first, LLM second (PRD §43.5).** Candidate impacts come from graph
  traversal: concept-to-symbol matching, then walking `IMPORTS`/`CALLS`/`READS_FROM`/`WRITES_TO`/
  `PUBLISHES`/`SUBSCRIBES_TO`/`TESTS`/`DEPLOYED_AS` edges from matched nodes. The model only
  classifies/ranks the **bounded candidate set** it is given — it never lists components freehand.
- **Evidence validation is a hard gate (PRD §34, §40.3, §43.2).** Every `nodeId`,
  `evidenceIds` entry, and `dependencyPath` hop must exist in the deterministic graph at the
  bound snapshot. References to nonexistent nodes are rejected; claims without supporting
  evidence are downgraded (recorded as warnings), never deleted and never promoted.
- The engine runs against a pre-indexed graph via application ports; no file I/O, no parsing here.
  Without an AI provider it still emits the deterministic subset (exact matches, direct
  dependencies) — PRD §8.
- Impact-tree first results < 15 s on a pre-indexed repo (PRD §33): traversal is bounded (depth
  and fan-out limits produce `MAY_AFFECT` cutoff warnings, not hangs).

## Domain rules

- Taxonomy is closed: the four likelihoods, sixteen impact types, and `direct`/`indirect` above.
  New values require a domain-model proposal + human approval, not an inline union extension.
- Confidence per PRD §14: computed from weighted signals (exact concept match, direct
  import/call, data access, API ownership, event relationship, shared context, framework
  convention, historical co-change, test association, human-confirmed mapping; penalties for
  graph distance, ambiguity, conflicting evidence, unsupported inference). Contributing signals
  are stored with every score so the UI can render "Confidence: 0.88 — + exact match with
  DealVisibilityPolicy, − one indirect event boundary". Never a bare model-authored number.
- Predicted impact edges are `MAY_AFFECT`/`AFFECTS` with `llm-inferred` provenance (or
  deterministic provenance for exact-match candidates); requirement links use `SATISFIES`/
  `REQUIRES`. Contradictory evidence is linked `CONTRADICTS`, kept visible.
- User decisions (PRD §40.3): accept, reject, and manual-add are append-only `UserImpactDecision`
  records. A rejected impact stays in the analysis with its decision; a manual impact carries
  `human-confirmed` provenance and still requires an existing `nodeId`.
- **Approval freezes.** An approved `ImpactAnalysis` is immutable and versioned; regeneration
  creates a new analysis version and marks the old one `superseded`. Nothing may edit an approved
  analysis — including "harmless" metadata fixes.
- Architectural options (PRD §26) list components affected, new/removed dependencies, data,
  performance, operational, consistency, complexity, migration, and testing implications plus
  advantages/risks; they are labeled AI-assisted, and selecting one is a recorded user decision.

## Security & privacy rules

- Candidate context sent for classification is minimized per the active privacy mode (symbols,
  signatures, selected ranges — PRD §9.2) and flows only through `packages/ai-inference`.
- Candidate node names/excerpts come from the repository and are untrusted prompt content
  (PRD §42.5); classification prompts must survive hostile symbol names.
- `explanation` strings are model text: rendered as text, never interpreted, never executed.

## Testing requirements

- Domain (`pnpm test:unit`): confidence weighting (required by PRD §42.1), decision append-only
  behavior, approval immutability, taxonomy validation.
- Application (`pnpm test:application`): full pipeline against an in-memory graph fake +
  `FakeModelProvider` from test-kit — including the case where the fake model returns invented
  node IDs (must reject) and unsupported claims (must downgrade to warnings).
- Golden impact results for sample specifications per fixture repo (PRD §42.3) in the `analyzers`
  project; the §46 milestone fixture must demonstrate at least one relevant dependency not named
  in the specification.
- Quality-metric awareness: goldens should exercise the §41 targets (direct-impact recall,
  unsupported-claim rate < 5%).

## Common failure modes

- Candidates generated by asking the LLM "which components will change?" instead of graph
  traversal — reintroduces hallucination and provider inconsistency (§43.2/§43.5).
- Confidence copied from the model response, or signals computed but thrown away after scoring.
- Rejected impacts deleted from the analysis instead of recorded as decisions — destroys the
  review baseline and the §Z9 learning loop.
- Approved analysis mutated in place ("just updating the explanation").
- `dependencyPath` fabricated from the explanation text rather than actual traversed edges.
- Manual impacts accepted with a free-text component name instead of a validated `nodeId`.
- Evidence validation run before snapshot binding, so impacts validate against a newer graph than
  the one analyzed.

## Checklist

- [ ] Candidate set is deterministic, bounded, and logged before any model call
- [ ] Every impact: existing nodeId, evidence IDs, dependency path, provenance, stored
      confidence signals
- [ ] Invalid model references rejected + downgrades recorded as warnings (tested)
- [ ] Decisions append-only; approval immutability tested; supersession creates a new version
- [ ] Works provider-free with deterministic subset; `pnpm test:unit`, `test:application`,
      `test:analyzers`, `quality:gates` green
- [ ] `/review-provenance` run — this engine mints knowledge records

## Definition of done

Main-skill definition of done, plus: golden fixtures prove recall on the sample specs, the
unsupported-claim path is demonstrably closed under test, an approved analysis cannot be altered
by any code path, and every confidence number in the output can be explained from its stored
signals.
