# UI Wireframes (PRD §44 Phase 0, §18)

These are **descriptive, not speculative**: each wireframe is drawn from the surface that actually
ships, so they double as a review aid ("does the built thing match what we intended?") rather than
a plan for something unbuilt. Where a §18 element is deliberately absent, the wireframe says so
instead of drawing it.

Rendering rules that constrain every frame below, and that a redesign must not break:

- **The three knowledge categories are distinguishable without colour** (§3, §37). Every frame
  shows the text badge — `[deterministic]`, `[ai-inferred]`, `[human-confirmed]` — because colour
  alone is not a distinction a high-contrast or colour-blind user can read.
- **Confidence is never a bare number.** Wherever a score appears, its contributing signals are
  reachable in the same view (§14).
- **Absent data reads as absent.** "No context assigned" and "not indexed" are rendered states,
  never blanks that imply zero.

---

## 1. Specification panel (§18.2, Story 9.1)

Webview. Paste / import a spec, review extracted requirements, answer open questions, analyze.

```
┌─ ImpactGraph: Specification ───────────────────────────────────────────────┐
│ Deal visibility                                    v3 · readiness 72 / 100 │
│ markdown · spec-deal-visibility · updated 2026-08-02T09:14Z                │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ [ Paste ]  [ Import current file ]  [ Import selection ]  [ Analyze ▸ ] │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│ Requirements (3)                                                           │
│  ▸ R1  Expired deals must disappear from search.        confirmed  [edit]  │
│  ▸ R2  Admins can still see expired deals.              draft      [✓][✕]  │
│  ▸ R3  Expiry is 90 days after close.                   rejected           │
│                                                                            │
│ Open questions (2)                        ordered blocking → important →   │
│  ▸ [blocking]  'Filter at read time' or 'Publish expiry events'?           │
│      The readings lead to different changes in deal-updated, DealSearch…   │
│      History: 'infra/pubsub.tf' changed in 4 of the last 20 commits.       │
│      ○ Option A — Filter at read time        affects 6 components          │
│      ○ Option B — Publish expiry events      affects 11 components         │
│      [ Answer… ]  [ Dismiss ]                                              │
│  ▸ [minor]     Should the admin view paginate?          [ Answer… ]        │
│                                                                            │
│ ⚠ interpretation unavailable for R3: provider-unavailable                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes: readiness is **computed** from open-question state (§C10), never model-authored. Options
are labelled AI-assisted in their description text; selecting one records a decision **and**
answers the linked question (§C8).

---

## 2. Impact tree (§18.3, Story 9.2)

Native VS Code tree — the accessible alternative to the graph, and the default surface.

```
IMPACTGRAPH: CURRENT IMPACT
▾ Deal visibility v3 — analysis-…-a7f (draft, 14 impacts)
  ▾ R1  Expired deals must disappear from search.            9 impact(s)
    ▾ required                                                          1
      • DealVisibilityPolicy   required · business-rule · 0.90 · static-analysis
          type: business-rule (direct)
          confidence: 0.90                       provenance: static-analysis
          src/policy/deal-visibility-policy.ts   evidence
    ▾ likely                                                            3
      • deals (table)          likely · data-model · 0.65 · static-analysis
          via: sym:policy → table:deals
    ▾ possible                                                          5
      • DealSearchIndexer      possible · integration · 0.50 · llm-inferred
  ▸ R2  Admins can still see expired deals.                   5 impact(s)

  Filters: likelihood ▾  impact type ▾    Group by: Context ▾
```

Notes: likelihood, type, confidence and provenance are all **text** on the item line. Grouping
offers Context / Requirement / Impact type / Likelihood / Knowledge category; Context is the
§18.4 default and shows "no context assigned" for unassigned components.

---

## 3. Impact graph (§18.4, Story 9.5)

Webview, Cytoscape + fcose. Compound parents are contexts; the node budget is enforced visibly.

```
┌─ ImpactGraph: Impact graph ────────────────────────────────────────────────┐
│ search […………]  type ▾  confidence ▾  ☐ inferred only  ☐ hide unchanged     │
│ group by: Context ▾                                                        │
│ Showing 200 of 412 matching nodes (1,038 in the analysis). 212 hidden —    │
│ expand a group.                                                            │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │  ╭─ deal-management ─────────╮      ╭─ search ────────────╮            │ │
│ │  │  (DealVisibilityPolicy)   │─────▶│  (DealSearchIndexer)│            │ │
│ │  │   ▲ required              │      │   ░ possible        │            │ │
│ │  │  (deals)  ▲ likely        │      ╰──── +18 more [＋] ──╯            │ │
│ │  ╰───────────────────────────╯                                         │ │
│ │  ╭─ no context assigned ─────╮      ── direct    ┈┈ indirect           │ │
│ │  │  (Mailer)  ░ possible     │      ▲ deterministic  ░ ai-inferred     │ │
│ │  ╰───────────────────────────╯      ◆ human-confirmed                  │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes: shape and line style carry meaning; colour is decoration. Layout animation is disabled
under `prefers-reduced-motion`. Truncation is always announced — never a silently smaller graph.

---

## 4. Evidence panel (§18.5, Story 9.3)

Bound to graph or list selection.

```
┌─ Evidence ─────────────────────────────────────────────────────────────────┐
│ DealVisibilityPolicy                          [deterministic]              │
│ requirement  R1 Expired deals must disappear from search.                  │
│ expected     Review DealVisibilityPolicy against requirement R1            │
│ likelihood   required        directness  direct                            │
│ provenance   static-analysis context     deal-management                   │
│                                                                            │
│ Confidence 0.90 — why                                                      │
│   + exact-concept-to-symbol-match   +0.90                                  │
│   + direct-import                   +0.10                                  │
│   − graph-distance                  −0.10                                  │
│                                                                            │
│ Dependency path   sym:policy → file:policy → file:query                    │
│ Source files      src/policy/deal-visibility-policy.ts:12–48  [open]       │
│ Related tests     deal-visibility-policy.test.ts                           │
│ Evidence          ev-3f2 file src/policy/…ts 12:0–48:1                     │
│ Human decisions   accepted by user · 2026-08-02 · "correct, ships with R1" │
│ Warnings          —                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes: the signal breakdown is the §14 stored signals, so the number is always explainable.
Missing fields render as `—`, never as a plausible default.

---

## 5. Review view (§18.7, §38.2, Story 11.4)

Native tree over a persisted review artifact.

```
IMPACTGRAPH: REVIEW
▾ review-…-c41   analysis-…-a7f v3 · working-tree · 2 discrepancies
  ▾ matched (4)
    • DealVisibilityPolicy        R1   src/policy/deal-visibility-policy.ts
  ▾ missing (1)
    • DealSearchIndexer           R1   required, but no change found
  ▾ unexpected (1)
    • rogue.ts                         changed, not in the approved analysis
  ▾ divergent (0)
  ▾ unverifiable (0)
  ▾ accepted deviation (1)
    • scaffold.ts                      "intentional scaffolding" — user
  ▾ requirement coverage
    • R1: partially-implemented
        ✓ DealVisibilityPolicy changed
        ✕ DealSearchIndexer unchanged
  ▾ rule violations (1)
    • schema-change-requires-migration   prisma/schema.prisma
```

Notes: coverage is an **estimate** with per-line evidence markers, never "R1 implemented". An
accepted deviation is a mark laid alongside a finding — the finding keeps its original category,
and a re-run review does not inherit the acceptance.

---

## Deliberately not drawn

- **Dependency-flow (layered) presentation** — ADR-0005 promises it via dagre, which is not
  installed. Only the force-directed view exists.
- **Current-vs-proposed relationships** — no DTO describes a proposed edge; drawing one would
  give invented structure the visual weight of fact.
- **Applications / integrations / infrastructure as graph groupings** — they exist as
  architecture-tree sections, not as graph compound parents.
