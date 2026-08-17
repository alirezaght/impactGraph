# ADR-0022 — Decision-first outputs and structural trust: ImpactGraph is a spec gate, not a graph explorer

Date: 2026-08-17
Status: Accepted
Extends: ADR-0015 (evidence basis and bounded output), ADR-0016 (architecture-aware concept
matching), ADR-0021 (built-in red-team analysis). Constrains ADR-0005 (graph view) in scope.

## Context

A second real-world evaluation (2026-08-17, product owner) ran ImpactGraph on a production task
and measured what earned its cost. What contributed: the specification forcing function, the
assumption checks ("does the symbol this spec assumes actually exist?"), freshness, and readiness
as a gate artifact. What did not: 1,031 impacts of which 559 rested on weak lexical/transitive
evidence — some shown as `required` / confidence 0.9; an assumption check that declared a member
missing when it was provided by a mixin base class; service-relative spec paths reported as
unresolved concepts; review marking intentionally-reused unchanged files as missing requirements;
a 170 KB review payload whose real answer ("zero violations") had to be mined with `jq`; prose
extraction that invented requirements until the author reformatted the document; and a truncated
176-node visualization nobody made a decision from.

Dogfooding this repository reproduced the failures locally: a normal design doc produced 505
impacts (389 name-similarity), the product name "ImpactGraph" anchored `package:impactgraph` as
`required`/0.9, package-relative paths landed in `unresolvedConcepts`, fallback extraction cut 20
"requirements" out of prose and withheld readiness pending a reformat, and the impact HTML export
rendered 185 truncated nodes.

The shared causes are architectural, not seven separate bugs:

1. **Anchor trust is not modeled.** Exact name equality on any node of any kind is treated as
   identifier-grade evidence (`required`, weight 0.9), with no concept-quality, genericity, or
   container gate; collision assessment is skipped for anything extension-shaped.
2. **Structural queries assume a closed world with one root and one hop.** Member existence reads
   only the container's own `DECLARES_MEMBER`/`CONTAINS` edges — never `EXTENDS`/`IMPLEMENTS`
   (which the adapters already emit) — and unresolved supertypes are dropped as warnings, so the
   checker cannot know a member set is open. Path resolution knows only verbatim
   workspace-root-relative equality; there is no suffix or scope resolution.
3. **Change intent and observed diff are conflated.** Impacts carry no expectation axis, so
   review's `required && !changed → missing` rule punishes deliberate reuse in three surfaces at
   once (findings, plan contract, breakdown).
4. **Output assembly is artifact-dump, not decision-first.** Review has no verdict block and
   uncapped per-file findings; analyze buries `planAssessment` two-thirds down; the MCP server
   serializes every payload twice; the graph export answers "what does the architecture look
   like", which is not the question anyone asked.
5. **Extraction quality is a document-level binary.** One missing bullet list flips the extractor
   from "trust the author" to "sentence-split everything", and per-statement uncertainty has
   nowhere to live, so it becomes invented requirements instead of open questions.

## Decision

**ImpactGraph is primarily a spec gate, assumption checker, and post-implementation verification
system. The graph is internal machinery. Every default surface returns a small number of
decision-relevant conclusions; volume is opt-in.**

Concretely:

**1. `required` means the specification named it or structure forces it.** Exact/alias _name_
matches to container-kind nodes (package, workspace, directory-like) cap at `possible` with a
weak-anchor confidence signal — naming a product is not naming a change surface. Bare filenames
(extension, no slash) are not identifier-grade: they participate in collision assessment and cap
at `likely` under the ADR-0015 tier mechanism. The 0.9 exact-match confidence weight is reserved
for identifier-grade anchors: unique path (or suffix) resolutions and symbol-grade name matches.

**2. Spec paths resolve against realistic scopes.** A path-shaped concept resolves by verbatim
workspace-relative equality, then by unique path-boundary suffix match across the indexed node
paths (covering repository-, service-, and package-relative forms without new configuration).
A unique suffix resolution is exact-grade; an ambiguous one becomes a clarification, never a
`required` anchor and never a false "unresolved concept" or invalid-assumption finding.

**3. Member existence is resolved through the type hierarchy, and nonexistence claims require a
closed world.** A pure domain graph query walks `EXTENDS`/`IMPLEMENTS` (cycle-guarded) comparing
bare member names, so mixin- and interface-provided members satisfy assumptions. Assembly records
unresolved supertypes on the class node; when the member set is open, the finding degrades to
"could not verify" (warning) instead of "is not a member" (blocking). Blocking nonexistence
findings state what was checked.

**4. Impacts carry a change expectation; review reports reuse positively.** A deterministic
recognizer (reuse/without-modification/verify language) sets
`changeExpectation: must-change | reuse-unchanged | verify-only` (defaulting accessor:
`must-change`). Review classifies `reuse-unchanged` + unchanged as a new positive category
`reuse-confirmed` (counts toward coverage, excluded from discrepancies); planned reuse that _was_
modified becomes `divergent`. Unchanged-means-missing survives only for `must-change` required
impacts.

**5. Every default output leads with the verdict and is bounded.** Review gains a first-key
`verdict` block (PASS / NEEDS_ATTENTION, counts by category, decisive finding refs) mirroring
analyze's `planAssessment`; findings are capped with explicit truncation counts and the full list
stays reachable through paging on `get_review_report`. Analyze reorders assessment-first and caps
unmatched-requirement detail. The MCP server stops double-serializing: `content.text` becomes a
short human-readable verdict, `structuredContent` carries the payload. Accepted deviations are
subtracted from the failure signal.

**6. Prose extraction is graduated, and uncertainty becomes questions.** A deterministic
per-statement classifier admits normative/imperative prose statements as requirements
(origin `prose-modal`, per-requirement extraction confidence), routes uncertain sentences to
open questions, and leaves rationale as context notes. Readiness is withheld only when the
extractor found mostly uncertainty — a well-written prose design doc gates on its content, not
its formatting. Concepts are mined only from admitted requirements.

**7. The default visual artifact is scoped to the decision.** The impact export's default view
shows the specification's strong-evidence surfaces plus one structural hop, findings attached,
lexical-only relationships excluded, within a human-readable node budget (~20); tables carry the
enumerable facts. The architecture-wallpaper view remains available explicitly, not as the
default answer to an analysis.

Broad impact discovery is retained but demoted: it feeds the model and stays reachable through
`list_impacts` filters; it no longer dominates any default surface.

## Options considered

- **Special-case each symptom** (patch the mixin case, hardcode path prefixes, cap the one noisy
  matcher): rejected — the evaluation explicitly identifies shared causes, and special cases
  would regress on the next repository.
- **Remove broad discovery and the graph view entirely**: rejected — completeness assurance and
  drift detection still need the graph; the failure is default prominence, not existence.
- **Let the calling agent ask for compact output** (prompt-side fix, no product change):
  rejected — ADR-0021 already established that relying on the caller to ask the right question
  recreates the failure.

## Consequences

- Positive: `required` regains meaning; assumption findings become trustworthy enough to block
  on; specs written in service vocabulary analyze cleanly; review results are readable without
  `jq`; reuse is rewarded instead of punished; prose design docs gate without reformatting.
- Negative / accepted costs: fewer impacts shown by default (volume behind filters); two new
  additive contract fields (`changeExpectation`, extraction confidence) and a review `verdict`
  block ripple through contracts and their tests; the closed-world blocking finding fires less
  often (some true nonexistence now reports as "could not verify" when supertypes are external —
  honesty over false certainty).
- Packages affected: domain (impact, repository, specification, review, preflight), application
  (build-impact-model, preflight, analyze-specification, review-implementation),
  repository-intelligence (unresolved-supertype facts), workspace-engine (reports), contracts,
  persistence (index cache schema), apps/mcp-server, apps/cli.
- Backward compatibility: all contract changes are additive with defaulting accessors; persisted
  artifacts remain readable; the SQLite index is a disposable cache and rebuilds.
- New human-approval obligations: none beyond the existing schema-change and ADR rules.

## Revisit trigger

The next real-world evaluation: if a spec gate still surfaces >2 false findings per run, or a
review verdict is contradicted by its own detail, the anchor-trust and closed-world models get
revisited. Also revisit if `reuse-confirmed` is observed masking genuinely missing work.

## Links

- PRD: §11, §13, §14, §18, §24, §25, §C2–C10
- Related ADRs: ADR-0015, ADR-0016, ADR-0021 (builds on); ADR-0005 (scopes the default view)
- Docs updated: docs/engineering/provenance-model.md, data-contracts.md, architecture.md
