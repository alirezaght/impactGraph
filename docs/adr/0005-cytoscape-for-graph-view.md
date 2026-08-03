# ADR-0005: Cytoscape.js for the Graph View

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

The graph view (PRD §18.4) is a read-mostly, interactive visualization inside the VS Code webview:
zoom, pan, search, expand/collapse, filter by impact type / confidence / provenance, group by
context / application / requirement, open source from node, show evidence, accept/reject impacts.
The default level is **Context → Component → integration or data dependency**, with drill-down to
Module → File → Symbol — i.e. hierarchical grouping is a first-class rendering concern. The view
defaults to fewer than 200 visible nodes (PRD §33) but drill-down and "filter unchanged
architecture" can push visible elements into the hundreds-to-thousands range. The webview imports
only `packages/contracts` (ADR-0004), so the library choice is contained, but graph libraries shape
the entire UI architecture, so we compare properly.

## Options Considered

### Option A — Cytoscape.js (chosen)

- Pros:
  - **Canvas rendering**: stays responsive at hundreds to low-thousands of rendered nodes/edges,
    which is exactly the drill-down envelope above the <200-node default (PRD §33, §43.1).
  - **Compound nodes** map directly onto the PRD §18.4 default level — Context contains Component
    contains Module/File — without us simulating hierarchy with hulls or synthetic edges.
  - **Graph layouts**: `cose` ships in the core; fcose (force-directed with compound support) and
    dagre (layered) are separate plugin packages that cover the "system architecture" and
    "dependency flow" presentations — no layout engine to write either way. (This bullet
    originally described fcose and dagre as _built-in_; they are not. See Outcome below.)
  - **Headless mode**: a Cytoscape instance runs without a DOM, so filtering, grouping, and
    element-mapping logic is unit-testable in Vitest (`test:webview` project) without a browser.
  - **Filtering/selector API**: expressive selectors implement the PRD's filter matrix (impact type,
    confidence threshold, provenance, unchanged architecture) as data queries rather than manual
    element bookkeeping — which also keeps the FACT/INFERENCE/CONFIRMED visual separation
    (ADR-0002) declarative.
- Cons:
  - Canvas means node interiors are drawn styles, not components: rich HTML inside nodes (badges,
    buttons, mini-panels) requires overlays or the html-label extension, both awkward.
  - React integration is imperative — Cytoscape owns its canvas; we bridge state with a controller
    layer instead of JSX composition.
  - Styling is Cytoscape's own stylesheet dialect, a second styling system next to the webview CSS.
  - Accessibility (PRD §37) needs custom work — canvas exposes nothing to the accessibility tree;
    we must provide keyboard navigation and an accessible list/tree alternative ourselves (the
    impact tree, PRD §18.3, partially covers this).

### Option B — React Flow

- Pros: outstanding DX — nodes are React components, so evidence badges, confidence meters, and
  provenance styling compose naturally; first-class controls/minimap; strong docs; ideal for
  node-_editor_ UIs.
- Cons: **DOM node per element** — performance degrades in the many-hundreds range as the DOM and
  React reconciliation become the bottleneck, precisely where drill-down takes us; its core strength
  is free-form interactive editing (dragging, connecting handles), which PRD §18.4 does not ask
  for — our mutations are accept/reject/add-impact actions, not spatial editing; no built-in
  automatic graph layout (external elkjs/dagre integration required) and no real compound-node
  concept — grouping (its subflows) is far weaker than Cytoscape compounds for three-level nesting.

### Option C — D3 (custom rendering)

- Pros: maximal flexibility — any visual encoding of provenance/confidence we can imagine; no
  library ceiling; d3-force is battle-tested; smallest conceptual dependency.
- Cons: D3 is a rendering toolkit, not a graph component — we would build and maintain layout
  orchestration for compound hierarchies, hit-testing, zoom/pan state, expand/collapse semantics,
  selection, and filtering ourselves; that is weeks of infrastructure before the first PRD §18.4
  feature, all of it ours to test and to keep under the 300-line file limit (ADR-0012); the graph
  view is one feature of the product, not the product.

## Decision

Cytoscape.js for V1. Compound nodes model Context → Component grouping; fcose is the default layout
with dagre for dependency-flow presentations; the selector API implements the PRD filter matrix;
headless instances back the webview unit tests. React remains the shell around the canvas (panels,
toolbars, evidence display), communicating with Cytoscape through a thin controller module. The
webview receives graph data exclusively as `contracts/webview` DTOs (ADR-0009).

## Consequences

- Positive: PRD §18.4 grouping and §33 node budgets are met with library primitives; layout and
  interaction are not our code to maintain; graph logic is testable headlessly in CI.
- Negative: two styling systems in the webview; an imperative bridge between React state and the
  Cytoscape instance that needs discipline; accessibility must be engineered explicitly alongside
  the canvas (tracked against PRD §37); rich in-node UI is effectively off the table.

## Revisit Trigger

If the UI pivots to heavy custom node interiors — interactive controls, forms, or rich component
content _inside_ nodes — React Flow's component-per-node model becomes the better fit and this ADR
should be reopened. Raw element-count performance alone is not a trigger; that favors staying.

## Outcome (2026-08-02) — fcose installed; ADR honoured for layout, dagre still absent

Two corrections and one resolution:

1. **fcose and dagre are not built into Cytoscape.** They are separate npm packages
   (`cytoscape-fcose`, `cytoscape-dagre`). The "Built-in graph layouts" bullet above said
   otherwise and has been corrected in place — that error is what made the initial divergence
   look accidental rather than deliberate.
2. **The webview shipped briefly on core `cose`**, because only `cytoscape` had been installed.
   The implementation flagged the divergence rather than silently adding a dependency.
3. **Resolved:** `cytoscape-fcose@2.2.0` is installed and registered, and the graph now lays out
   with fcose as this ADR specified. The layout plugin is registered once at module load
   (registering twice throws in some Cytoscape versions), and layout stays deterministic
   (`randomize: false`) so a re-render does not reshuffle a graph someone is mid-read of.

**Measured, not assumed** — the webview benchmark over the capped 201-element set:

| Layout            | Median    | Worst     | Budget   |
| ----------------- | --------- | --------- | -------- |
| `cose` (previous) | 467 ms    | 476 ms    | 2,000 ms |
| **`fcose` (now)** | **13 ms** | **25 ms** | 2,000 ms |

fcose is ~36× faster here _and_ separates compound parents properly, which is the §18.4
Context → Component readability this ADR chose Cytoscape for in the first place.

**Still open:** `cytoscape-dagre` is NOT installed, so the layered "dependency flow" presentation
this ADR promised does not exist — only the force-directed system-architecture view does. That is
a deliberate scope gap, not an oversight: add `cytoscape-dagre` when the dependency-flow view is
actually wanted, or amend the Decision to drop it.

## Links

- PRD §18.3–18.5, §33, §37, §43.1
- Related: ADR-0002 (visual category separation the view must render), ADR-0004 (webview →
  contracts only), ADR-0009, ADR-0012
- docs/engineering/performance-budgets.md, docs/engineering/testing-strategy.md
