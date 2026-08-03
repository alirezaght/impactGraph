import type { LayoutOptions, StylesheetStyle } from 'cytoscape';

// Cytoscape stylesheet (ADR-0005). Colour comes from VS Code theme variables so high-contrast
// themes work; MEANING comes from shape, border style, line style, and the text badge baked into
// every label (§37). Removing all colour must not remove a single distinction, so each knowledge
// category gets its own explicit selector rather than a colour ramp.

const themed = (token: string, fallback: string): string => `var(--vscode-${token}, ${fallback})`;

const BORDER = themed('focusBorder', '#888888');
const LINE = themed('editorLineNumber-foreground', '#888888');

export const graphStylesheet: StylesheetStyle[] = [
  {
    selector: 'node.impact-node',
    style: {
      shape: 'round-rectangle',
      label: 'data(label)',
      'text-wrap': 'wrap',
      'text-valign': 'center',
      'font-size': 11,
      width: 'label',
      height: 'label',
      padding: '8px',
      'border-width': 2,
      'border-style': 'solid',
      'border-color': BORDER,
      'background-color': themed('editorWidget-background', '#1e1e1e'),
      color: themed('editor-foreground', '#dddddd'),
    },
  },
  {
    selector: 'node.group',
    style: {
      shape: 'round-rectangle',
      label: 'data(label)',
      'text-valign': 'top',
      'font-size': 12,
      'border-width': 1,
      'border-style': 'dotted',
      'background-opacity': 0.06,
    },
  },
  // --- the three knowledge categories: shape + border style, never colour alone (§3, §37) ---
  {
    selector: 'node.knowledge-deterministic',
    style: { shape: 'round-rectangle', 'border-style': 'solid', 'border-width': 2 },
  },
  {
    selector: 'node.knowledge-ai-inferred',
    style: { shape: 'diamond', 'border-style': 'dashed', 'border-width': 3 },
  },
  {
    selector: 'node.knowledge-human-confirmed',
    style: { shape: 'hexagon', 'border-style': 'double', 'border-width': 6 },
  },
  {
    selector: 'node.knowledge-unclassified, node.knowledge-reserved',
    style: { shape: 'octagon', 'border-style': 'dotted', 'border-width': 2 },
  },
  {
    selector: 'edge.impact-edge',
    style: {
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      width: 1.5,
      'line-style': 'solid',
      label: 'data(label)',
      'font-size': 9,
      'text-rotation': 'autorotate',
      'line-color': LINE,
      'target-arrow-color': LINE,
    },
  },
  // Indirect reach is dotted AND labelled "(indirect, …)" — never colour alone.
  { selector: 'edge.directness-indirect', style: { 'line-style': 'dotted', width: 1 } },
  { selector: 'edge.directness-direct', style: { width: 2.5 } },
  { selector: 'edge.knowledge-ai-inferred', style: { 'line-style': 'dashed' } },
  // --- §18.4 the FOURTH line treatment: proposed structure --------------------------------
  // The three current treatments are solid (direct), dotted (indirect) and short-dash
  // (AI-inferred). A proposed relationship uses a LONG dash that none of them can produce, plus
  // a source arrow no current edge draws at all, plus the `[PROPOSED]` word in its label. Three
  // independent channels, none of them colour — it survives grayscale and high contrast.
  {
    selector: 'edge.proposed-edge',
    style: {
      'curve-style': 'bezier',
      'line-style': 'dashed',
      'line-dash-pattern': [14, 6],
      width: 2,
      'source-arrow-shape': 'diamond',
      'target-arrow-shape': 'triangle-tee',
      label: 'data(label)',
      'font-size': 9,
      'text-rotation': 'autorotate',
      'line-color': LINE,
      'source-arrow-color': LINE,
      'target-arrow-color': LINE,
    },
  },
  // A proposed COMPONENT keeps its knowledge shape/border (§3) and gains a ghosted outline —
  // "drawn but not built". Its label and compound parent both say "proposed" in words.
  {
    selector: 'node.proposed-node',
    style: {
      label: 'data(label)',
      'text-wrap': 'wrap',
      'text-valign': 'center',
      'font-size': 11,
      width: 'label',
      height: 'label',
      padding: '8px',
      'border-width': 4,
      'border-style': 'dashed',
      'border-color': BORDER,
      'background-opacity': 0.15,
      color: themed('editor-foreground', '#dddddd'),
      ghost: 'yes',
      'ghost-opacity': 0.35,
      'ghost-offset-x': 4,
      'ghost-offset-y': 4,
    },
  },
  { selector: ':selected', style: { 'overlay-opacity': 0.2 } },
];

/** fcose is not bundled; the built-in cose layout covers the compound default (ADR-0005). */
/**
 * ADR-0005 names fcose: force-directed WITH compound support, which is what makes the §18.4
 * Context → Component grouping readable — plain `cose` packs compound parents loosely enough
 * that groups visually overlap. `quality: 'default'` and a fixed `randomize: false` keep layout
 * deterministic run to run, so a re-render does not reshuffle a graph the user is reading.
 */
export const layoutOptions = (reducedMotion: boolean): LayoutOptions =>
  ({
    name: 'fcose',
    animate: !reducedMotion,
    animationDuration: reducedMotion ? 0 : 300,
    nodeDimensionsIncludeLabels: true,
    randomize: false,
    quality: 'default',
    // Compound separation: keep members of a context together and contexts apart.
    nodeRepulsion: 6_000,
    idealEdgeLength: 80,
    nestingFactor: 0.1,
    fit: true,
    padding: 24,
  }) as unknown as LayoutOptions;
