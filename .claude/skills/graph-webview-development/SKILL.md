---
name: graph-webview-development
description: Use when building or reviewing the React + Cytoscape.js webview UI in apps/vscode-extension/webview — impact graph, impact tree, evidence panel, review view. Covers compound-node grouping, progressive disclosure, provenance-distinct rendering, typed message handling, accessibility, empty states, and large-graph degradation. Triggers on Cytoscape, fcose, webview components, graph filters, and evidence panel work.
---

# Graph Webview Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill adds rules for `apps/vscode-extension/webview` (React + Vite + Cytoscape.js,
ADR-0005). Owning agent: `graph-webview`. Backlog: `backlog/epic-09-impact-ui.md`.

## Purpose

Render impact analyses, the architecture graph, evidence, and review results faithfully —
including their uncertainty — and forward user intent to the extension host. The webview
**renders and requests; it never decides** (main skill §9).

## When to use

- Any change under `apps/vscode-extension/webview`: graph view (PRD §18.4), impact tree
  (§18.3), evidence panel (§18.5), architecture view (§18.6), review view (§18.7).
- Cytoscape styling, layouts (fcose), filters, grouping, selection, or interaction handlers.
- Webview-side message handling for `packages/contracts/webview` messages.

## When NOT to use

- The host side of webview communication (panel creation, CSP, message dispatch) →
  `vscode-extension-development`.
- Defining or versioning message schemas → `typed-message-contract-development`.
- Rendering performance _investigation_ with numbers → `performance-investigation`.

## Required context

PRD §18.3–18.7 (views), §33 (node budget), §37 (accessibility), §43.1 (graph explosion),
§43.6 (false authority); ADR-0005; `docs/engineering/data-contracts.md`.

## Expected outputs

React components + Cytoscape configuration, message handlers validated with contracts, vitest
tests in the `webview` project, and — for new visual states — a note in the PR showing how the
three knowledge categories remain distinguishable.

## Architectural rules

- **Imports ONLY `packages/contracts`.** Never domain, application, adapters, or `vscode`.
  All data arrives as versioned DTOs; all intent leaves as versioned messages. Validate incoming
  messages with the contract schema before rendering (both ends validate — main skill §5).
- **Tree-first** (PRD §37, §43.1): every piece of information reachable in the graph must also be
  reachable through the impact tree. The graph is an optional view, never the only access path.
- **Default < 200 visible nodes** (PRD §33). Default level is
  `Context → Component → Integration/data dependency` (§18.4) with compound Cytoscape nodes
  grouping Components inside their Context. Drill-down to `Module → File → Symbol` is on-demand
  expansion only. Never render the full symbol graph by default.
- Required graph features (PRD §18.4): zoom, pan, search, expand/collapse, filter by impact type
  / confidence / inferred relationships / unchanged architecture, group by context / application /
  requirement, direct-vs-indirect display, open source file from node, show evidence, accept or
  reject impact, add missing impact.
- **Accept / reject / approve / add-impact interactions send typed request messages** to the
  host and wait for the authoritative result message. The webview never marks an impact accepted
  locally as the source of truth — optimistic UI must reconcile with the host response and roll
  back on rejection.
- Large-graph degradation (PRD §43.1): past the node budget, collapse to context level, show a
  count badge ("312 components hidden — expand a context"), and offer filters — never freeze,
  never silently truncate without telling the user.
- Empty states are designed, not accidental: no index yet ("Run ImpactGraph: Initialize
  Workspace"), no analysis, analysis with zero impacts, review with zero discrepancies — each
  with the next action.

## Domain rules — provenance rendering (the core invariant)

- Deterministic, AI-inferred, and human-confirmed knowledge must be visually distinct **and**
  color-independent (PRD §37, §43.6): distinct node/edge shapes or border styles AND a text/icon
  label (e.g. edge badge `inferred`) in addition to any color. A grayscale screenshot must still
  distinguish the three categories — add a test or storybook-style fixture proving it.
- Confidence is shown as a number/label with its contributing factors, never only as color
  saturation. "Unverifiable" is a rendered status, not a hidden one (PRD §43.6).
- Evidence panel (PRD §18.5) shows, for the selected impact: impact explanation, requirement,
  expected change, confidence + confidence factors, provenance, direct/indirect classification,
  dependency path, source files, symbols, relevant source ranges, related tests, human
  decisions, and warnings. Fields absent from the DTO render as explicitly absent — never
  fabricated or defaulted to reassuring values.
- Filters may hide inferred edges; they may never re-style them to look deterministic.

## Security & privacy rules

- Strict CSP (host-enforced) means no external fonts, scripts, or telemetry from the webview.
- Render repository-derived strings (file paths, symbol names, spec text) as text, never as HTML
  — repository content is untrusted (PRD §42.5); no `dangerouslySetInnerHTML` on it.
- The webview never sees secrets, provider keys, or raw prompts; if a DTO seems to need one,
  the contract is wrong — escalate via `/review-contracts`.

## Testing requirements

- Vitest `webview` project (`pnpm test:webview`): component tests (jsdom), message-handler tests
  that feed schema-valid and schema-invalid messages, provenance-rendering tests (three
  categories distinguishable without color), progressive-disclosure tests (node budget respected
  on a large fixture graph from `packages/test-kit`).
- Cytoscape logic (element mapping, filter predicates, compound grouping) is extracted into pure
  functions tested headlessly.
- Playwright end-to-end tests arrive in a later milestone (main skill §6) — don't block on them,
  don't fake them.

## Accessibility requirements (PRD §37)

Keyboard navigation for tree and graph (focusable nodes, arrow-key traversal, Enter to open
evidence), screen-reader labels on nodes/edges/badges, high-contrast theme support, focus
management on panel open/close, resizable panels, and `prefers-reduced-motion` disables layout
animation. Every graph interaction has a tree or command equivalent.

## Common failure modes

- Encoding provenance only in color — fails §37 and grayscale review.
- Letting the webview flip an impact to "accepted" locally and treating that as done — the host
  decision message is the truth.
- Rendering all nodes then filtering visually — layout cost already paid; filter the element
  list before Cytoscape sees it.
- Importing a domain type "just for the enum" — copy the literal union into contracts instead.
- Re-running fcose layout on every message — layout only on structural change.
- An empty evidence field rendered as `confidence: 100%` because of a default.

## Checklist

- [ ] Webview imports only `packages/contracts` (ESLint boundary green)
- [ ] All new messages validated on the webview side; unknown versions handled explicitly
- [ ] Three knowledge categories distinct without color; screenshot or fixture proves it
- [ ] Node budget respected; degradation and empty states implemented for the new view
- [ ] Decisions flow host-ward as typed requests; reconciliation on response
- [ ] Keyboard + screen-reader path exists; reduced motion respected
- [ ] `pnpm test:webview` green; tree exposes everything the graph shows

## Definition of done

The view renders contract DTOs faithfully — provenance, confidence, and absence included —
stays under the node budget with graceful degradation, is fully reachable via tree and
keyboard, sends decisions as typed messages it does not pre-empt, and its tests pin all of that.
