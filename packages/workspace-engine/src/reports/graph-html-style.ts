// The export's entire stylesheet, inlined. No @import, no @font-face, no remote URL: the file
// must render identically on a machine with no network at all (PRD §35, CLAUDE.md rule 5).
//
// Meaning is carried by shape, stroke pattern and text. The palette is greyscale on purpose so
// that nothing in the diagram can be read only by hue (§37), and it adapts to the reader's
// light/dark preference without any script.

export const GRAPH_STYLESHEET = `
:root {
  --ink: #111418;
  --ink-soft: #4a5158;
  --paper: #ffffff;
  --panel: #f4f5f7;
  --rule: #b9bec4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e9ecef;
    --ink-soft: #a8b0b8;
    --paper: #14171a;
    --panel: #1e2226;
    --rule: #565d64;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
}
/* Wide enough for the diagram and the tables; prose is capped separately so it stays readable. */
main { max-width: 100rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.25rem 0 .75rem; }
p { margin: .5rem 0; max-width: 62rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
a { color: inherit; }
.subtitle { color: var(--ink-soft); margin: 0 0 1rem; }
.skip { position: absolute; left: -9999px; }
.skip:focus { position: static; display: inline-block; margin-bottom: 1rem; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: .75rem 0; }
.facts dt { color: var(--ink-soft); }
.facts dd { margin: 0; font-variant-numeric: tabular-nums; }
.budget { border-left: 3px solid var(--rule); padding-left: .75rem; }
.note { color: var(--ink-soft); }
.badge {
  display: inline-block;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 .3rem;
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .04em;
  white-space: nowrap;
}
.legend { list-style: none; padding: 0; margin: 0; display: grid; gap: .75rem; }
.legend li { display: flex; gap: 1rem; align-items: flex-start; border-top: 1px solid var(--rule); padding-top: .75rem; }
.legend p { margin: .2rem 0 0; color: var(--ink-soft); }
.swatch { flex: 0 0 auto; color: var(--ink); }
/* The diagram keeps its natural size so the labels stay readable; the viewport scrolls. */
.scroller {
  overflow: auto;
  max-height: 85vh;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--panel);
}
.diagram { display: block; color: var(--ink); }
.diagram text { font-family: inherit; fill: var(--ink); }
.group-shape { fill: var(--paper); stroke: var(--rule); stroke-width: 1; }
.group-label { font-size: 14px; font-weight: 700; }
.group-meta { font-size: 10.5px; fill: var(--ink-soft); font-variant-numeric: tabular-nums; }
.node-shape { fill: var(--panel); stroke: var(--ink); }
.node-shape.inner { stroke: var(--ink); }
.member-name { font-size: 12px; font-weight: 600; }
.member-meta { font-size: 9.5px; fill: var(--ink-soft); letter-spacing: .02em; }
/* Likelihood: the meter is a COUNT OF FILLED SHAPES, not a shade — it survives greyscale and a
   monochrome printout, and the spelled-out word sits beside it either way (§37). */
.member-likelihood { font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.meter-on { fill: var(--ink); stroke: var(--ink); stroke-width: 1; }
.meter-off { fill: none; stroke: var(--ink); stroke-width: 1; }
.edge-line { fill: none; stroke: var(--ink); stroke-width: 1.6; }
.edge-label-bg { fill: var(--paper); stroke: var(--rule); stroke-width: .75; }
.edge-label { font-size: 10px; text-anchor: middle; font-variant-numeric: tabular-nums; }
table { border-collapse: collapse; width: 100%; font-size: .875rem; }
caption { text-align: left; color: var(--ink-soft); padding-bottom: .5rem; }
th, td { border: 1px solid var(--rule); padding: .3rem .5rem; text-align: left; vertical-align: top; }
th { background: var(--panel); }
td:nth-child(n + 2) { font-variant-numeric: tabular-nums; }
footer { margin-top: 2.5rem; border-top: 1px solid var(--rule); padding-top: 1rem; color: var(--ink-soft); }
@media print {
  :root { --paper: #ffffff; --panel: #ffffff; --ink: #000000; --ink-soft: #333333; --rule: #666666; }
  body { padding: 0; }
  .scroller { border: none; max-height: none; overflow: visible; }
}
`;
