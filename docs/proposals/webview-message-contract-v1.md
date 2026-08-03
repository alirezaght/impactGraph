# Webview Message Contract: `webview` protocol v1 (Epic 09)

_Filled from `.claude/templates/webview-message-contract.md`. Covers every message type crossing the
extension ↔ webview boundary (`packages/contracts/src/webview`, ADR-0009). The webview imports only
`packages/contracts` — never domain, never `vscode`._

- **Protocol version:** `WEBVIEW_PROTOCOL_VERSION = 1` (new — no prior webview protocol existed)
- **PRD grounding:** §18.2 (specification view), §18.4 (graph view), §18.5 (evidence panel), §14
  (confidence signals), §3/§12.3 (provenance), §33/§43.1 (node budget), §37 (accessibility)
- **Backlog:** `backlog/epic-09-impact-ui.md` — stories 9.1, 9.3, 9.5

## Envelope

Every message is `{ protocolVersion: 1, type, payload }`. `parseVersionedMessage` checks, in order:
envelope shape → protocol version → known type → payload schema, and returns a **typed** error
(`malformed` | `unsupported-protocol-version` | `unknown-type` | `invalid-payload`). An unknown
protocol version is never best-effort parsed on either end.

## Message roster

### Extension → webview (`hostMessageSchema`)

| type                 | payload                      | notes                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------- |
| `host/specification` | `specificationPanelStateDto` | §18.2 requirements, open questions, readiness, versions |
| `host/graph`         | `impactGraphDto`             | §18.4 nodes/edges + `totalNodeCount` (pre-cap)          |
| `host/evidence`      | `evidencePanelStateDto`      | §18.5 incl. §14 confidence signals via `explain_node`   |
| `host/status`        | `{ busy, label?, notice? }`  | progress while an engine job runs                       |
| `host/error`         | `{ code, message }`          | typed failure surfaced in the UI, never swallowed       |

### Webview → extension (`webviewMessageSchema`)

`webview/ready`, `webview/refresh`, `webview/import-specification`,
`webview/analyze-specification`, `webview/save-specification-version`,
`webview/compare-specification-versions`, `webview/answer-question`, `webview/dismiss-question`,
`webview/requirement-decision`, `webview/edit-requirement`, `webview/open-source`,
`webview/select-node`, `webview/impact-decision`, `webview/add-manual-impact`.

## Validation on both ends

- **Extension side:** `ImpactReviewPanel.listen` parses every inbound message with
  `parseWebviewMessage` before any handler runs; `ImpactReviewPanel.post` re-validates every
  outbound message with `hostMessageSchema` before `postMessage`.
- **Webview side:** `subscribeToHost` parses with `parseHostMessage` before dispatching to the
  reducer; `postToHost` validates the request with `webviewMessageSchema` before posting.
- **On failure:** the message is dropped whole (never partially applied). The host answers with
  `host/error`; the webview records the parse error in its visible error banner.

## What the webview may and may NOT decide

- **May:** local view state only — filters, grouping dimension, expanded groups, active selection,
  editor draft text; and emit intent for everything else.
- **May NOT:** mark an impact accepted/rejected, answer a question, confirm a requirement, compute
  confidence, reclassify provenance, or persist anything. Every one of those is a request whose
  authoritative outcome arrives as a fresh `host/*` state message.

## Provenance fields exposed for display (PRD §3, §12.3)

- `provenance` — on every graph node and on the evidence impact block.
- `knowledgeCategory` — derived by the host with `knowledgeCategoryForProvenance`; **absent** when
  the provenance is unknown, so the webview renders `UNCLASSIFIED` rather than a fact.
- `confidence` + `confidenceSignals` (type + signed contribution) — §14 "why this score".
- `evidence[].id/source/range` — §40.4 range-accurate reveal.
- Staleness: not yet carried — the analyze document does not expose it (open, see backlog).

## Accessibility implications (PRD §37)

- Knowledge categories are distinguished by node shape, border style **and** a text badge
  (`FACT` / `INFERRED` / `CONFIRMED` / `UNCLASSIFIED`) baked into the Cytoscape label and rendered
  as a `.badge` element with `data-knowledge-category` in every list.
- The node list is the keyboard/screen-reader equivalent of the canvas; every graph capability
  (select, open source, accept/reject) exists there as a real `<button>`.
- Layout animation is disabled under `prefers-reduced-motion`.
- Confidence is text (`confidence: 0.88 (high)`), never colour alone.

## Contract tests

- `contract` project — `packages/contracts/src/webview/webview-contracts.test.ts`: valid parse,
  unsupported version rejected, unknown type rejected, invalid payload rejected, strict payloads,
  roster ↔ schema sync, and the provenance → category mapping (plus a domain-alignment test).
- `webview` project — `messaging.test.ts` (both directions, unknown version), `graph-logic.test.ts`
  (three categories distinct by shape/border/text), `panels.test.tsx` (rendering + intent-only).
- `extension` project — `webview-host.test.ts`: CSP/nonce construction and the DTO mappers.

## Human approval required

This is a **new** contract surface (protocol v1) plus two new generated JSON Schemas
(`schemas/webview/host-message.v1.schema.json`, `schemas/webview/webview-message.v1.schema.json`).
No existing schema changed shape. Approval needed per CLAUDE.md ("any persisted schema change or
contract version bump").
