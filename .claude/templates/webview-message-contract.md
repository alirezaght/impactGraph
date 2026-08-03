# Webview Message Contract: <message name>

_For every message type crossing the extension ↔ webview boundary (contracts/webview, ADR-0009).
Reviewed by graph-webview + vscode-integration agents via `/review-contracts`. The webview imports
only packages/contracts — never domain._

- **Message name:** <e.g. `graph/showImpactTree`>
- **Direction:** extension → webview | webview → extension
- **schemaVersion:** <n> (bump: <old>→<new> | new message)
- **PRD grounding:** §18.<n> (UI), §37 (accessibility); epic backlog/epic-09-impact-ui.md or <...>

## Zod sketch

```ts
const <Name>Message = z.object({
  type: z.literal("<message name>"),
  schemaVersion: z.literal(<n>),
  payload: z.object({
    // <DTO fields only — stable IDs, no domain objects, no functions>
  }),
});
```

## Validation on both ends

- Extension side: <where parsed — on receive before dispatch / on send before post>
- Webview side: <where parsed>
- On validation failure: <typed error surfaced how; message dropped, never partially applied>

## What the webview may and may NOT decide

_The webview renders and requests; it never decides (main skill §9). Be explicit._

- May: <e.g. request node expansion, emit accept/reject intent, change local view filters>
- May NOT: <e.g. compute confidence, change impact status directly, merge knowledge categories,
  mutate any persisted state — all state changes go through a use case on the extension side>

## Provenance fields exposed for display (PRD §3, §12.3)

_Knowledge-bearing payloads must let the UI keep FACT / INFERENCE / CONFIRMED visually separate._

- provenance: <included? which values possible>
- confidence + contributing signals (PRD §14 — the UI must expose _why_): <included?>
- evidenceIds / evidence summaries: <included?>
- staleness flag: <included?>
- If none apply: state why this message carries no knowledge <...>

## Accessibility implications (PRD §37)

- <e.g. new tree items need labels/roles; category distinction must not rely on color alone;
  keyboard path for the action exists> | none — pure data refresh

## Contract tests (vitest `contract` + `webview` projects)

- [ ] contract: valid message parses; invalid payload rejected; version mismatch rejected
- [ ] contract: knowledge payloads always include provenance (schema-enforced, not convention)
- [ ] webview: render path for each provenance value visually distinct (snapshot or role assertion)
- [ ] webview: outbound message built by the UI validates against this schema
