import { buildRows, LAYER_GAP_Y, MARGIN, MIN_ROW_WIDTH, placeRows } from './graph-layout-rows.js';

import type { GroupBox } from './graph-layout-rows.js';
import type { GraphView, GraphViewEdge } from './graph-view-model.js';

export type { GroupBox, MemberBox } from './graph-layout-rows.js';

// Deterministic layered layout, shared by both view sources. Every coordinate is a pure function
// of the view:
//   1. layer = longest path over the aggregated group edges, relaxed in a bounded number of
//      passes and clamped, so cycles terminate instead of diverging;
//   2. groups inside a layer are ordered by label (a total order — labels are unique group ids);
//   3. sizes come from member counts, positions from cumulative sums, all integer-rounded.
// No randomness, no force simulation, no clock. Same view in ⇒ same bytes out.

const MAX_LAYERS = 12;
const PARALLEL_OFFSET = 26;
/** How far a same-row edge dips below its row, so its label lands in the row gap. */
const SIDEWAYS_DROP = 96;

export interface EdgePath {
  readonly edge: GraphViewEdge;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  readonly groups: readonly GroupBox[];
  readonly edges: readonly EdgePath[];
}

/** Longest-path layering, clamped so a dependency cycle cannot grow the diagram forever. */
const assignLayers = (view: GraphView): Map<string, number> => {
  const layers = new Map<string, number>(view.groups.map((group) => [group.id, 0]));
  const passes = Math.min(view.groups.length, MAX_LAYERS);
  for (let pass = 0; pass < passes; pass += 1) {
    let changed = false;
    for (const edge of view.edges) {
      const next = Math.min((layers.get(edge.sourceGroupId) ?? 0) + 1, MAX_LAYERS - 1);
      if (next > (layers.get(edge.targetGroupId) ?? 0)) {
        layers.set(edge.targetGroupId, next);
        changed = true;
      }
    }
    if (!changed) {
      return layers;
    }
  }
  return layers;
};

interface Point {
  readonly x: number;
  readonly y: number;
}

const curve = (p0: Point, c1: Point, c2: Point, p3: Point): Omit<EdgePath, 'edge'> => ({
  path: `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`,
  labelX: Math.round((p0.x + 3 * c1.x + 3 * c2.x + p3.x) / 8),
  labelY: Math.round((p0.y + 3 * c1.y + 3 * c2.y + p3.y) / 8),
});

const centreX = (box: GroupBox): number => box.x + Math.round(box.width / 2);
const centreY = (box: GroupBox): number => box.y + Math.round(box.height / 2);

/** Forward edge: bottom of the source down to the top of the target. */
const downward = (source: GroupBox, target: GroupBox, shift: number): Omit<EdgePath, 'edge'> => {
  const p0 = { x: centreX(source) + shift, y: source.y + source.height };
  const p3 = { x: centreX(target) + shift, y: target.y };
  const bend = Math.max(30, Math.round((p3.y - p0.y) / 2));
  return curve(p0, { x: p0.x, y: p0.y + bend }, { x: p3.x, y: p3.y - bend }, p3);
};

/** Back edge (target sits in an earlier layer): routed clear of the boxes on the right. */
const upward = (source: GroupBox, target: GroupBox, shift: number): Omit<EdgePath, 'edge'> => {
  const p0 = { x: source.x + source.width, y: centreY(source) };
  const p3 = { x: target.x + target.width, y: centreY(target) };
  const reach = 96 + Math.abs(shift);
  return curve(p0, { x: p0.x + reach, y: p0.y }, { x: p3.x + reach, y: p3.y }, p3);
};

/**
 * Same row: leave the bottom of the source, bow well below the row, and come back up into the
 * bottom of the target. The gap between two adjacent boxes is narrower than an edge label, so a
 * shallow curve would stack every label on top of the boxes — the dip puts them in the row gap.
 */
const sideways = (source: GroupBox, target: GroupBox, shift: number): Omit<EdgePath, 'edge'> => {
  const p0 = { x: centreX(source), y: source.y + source.height };
  const p3 = { x: centreX(target), y: target.y + target.height };
  const drop = SIDEWAYS_DROP + Math.abs(shift);
  return curve(p0, { x: p0.x, y: p0.y + drop }, { x: p3.x, y: p3.y + drop }, p3);
};

const routeEdges = (view: GraphView, boxes: readonly GroupBox[]): EdgePath[] => {
  const byId = new Map(boxes.map((box) => [box.group.id, box] as const));
  const seen = new Map<string, number>();
  const paths: EdgePath[] = [];
  for (const edge of view.edges) {
    const source = byId.get(edge.sourceGroupId);
    const target = byId.get(edge.targetGroupId);
    if (source === undefined || target === undefined) {
      continue;
    }
    const key = `${edge.sourceGroupId} ${edge.targetGroupId}`;
    const rank = seen.get(key) ?? 0;
    seen.set(key, rank + 1);
    const shift = rank * PARALLEL_OFFSET;
    if (target.row > source.row) {
      paths.push({ edge, ...downward(source, target, shift) });
    } else if (target.row < source.row) {
      paths.push({ edge, ...upward(source, target, shift) });
    } else {
      paths.push({ edge, ...sideways(source, target, shift) });
    }
  }
  return paths;
};

export const layoutGraphView = (view: GraphView): GraphLayout => {
  const rows = buildRows(view, assignLayers(view));
  const widest = rows.reduce((width, row) => Math.max(width, row.width), MIN_ROW_WIDTH);
  const canvasWidth = widest + 2 * MARGIN;
  const groups = placeRows(view, rows, canvasWidth);
  const height =
    rows.reduce((total, row) => total + row.height + LAYER_GAP_Y, 0) - LAYER_GAP_Y + 2 * MARGIN;
  return {
    width: canvasWidth,
    height: Math.max(height, 2 * MARGIN),
    groups,
    edges: routeEdges(view, groups),
  };
};
