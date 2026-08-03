import type {
  GraphView,
  GraphViewEdge,
  GraphViewGroup,
  GraphViewNode,
} from './graph-view-model.js';

// Deterministic layered layout. Every coordinate is a pure function of the view:
//   1. layer = longest path over the aggregated group edges, relaxed in a bounded number of
//      passes and clamped, so cycles terminate instead of diverging;
//   2. groups inside a layer are ordered by label (a total order — labels are unique group ids);
//   3. sizes come from member counts, positions from cumulative sums, all integer-rounded.
// No randomness, no force simulation, no clock. Same view in ⇒ same bytes out.

const MARGIN = 48;
const GROUP_GAP_X = 44;
const LAYER_GAP_Y = 116;
const GROUP_PAD = 14;
const GROUP_HEADER = 64;
const CELL_W = 176;
const CELL_H = 52;
const CELL_GAP = 10;
const MIN_GROUP_W = 244;
const MAX_COLS = 4;
const MAX_LAYERS = 12;
const PARALLEL_OFFSET = 26;
/** Wrap a too-wide layer rather than emitting a diagram nobody can see the whole of. */
const MAX_ROW_WIDTH = 1500;
/** How far a same-row edge dips below its row, so its label lands in the row gap. */
const SIDEWAYS_DROP = 96;

export interface MemberBox {
  readonly node: GraphViewNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GroupBox {
  readonly group: GraphViewGroup;
  /** Dependency depth (informational). A wide layer may occupy several rows. */
  readonly layer: number;
  /** Vertical band the box was placed in. Edge routing compares rows, not layers. */
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly members: readonly MemberBox[];
}

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

interface Size {
  readonly cols: number;
  readonly width: number;
  readonly height: number;
}

const sizeFor = (memberCount: number): Size => {
  const cols = memberCount === 0 ? 0 : Math.min(MAX_COLS, Math.ceil(Math.sqrt(memberCount)));
  const rows = cols === 0 ? 0 : Math.ceil(memberCount / cols);
  const inner = cols === 0 ? 0 : cols * CELL_W + (cols - 1) * CELL_GAP;
  return {
    cols,
    width: Math.max(MIN_GROUP_W, GROUP_PAD * 2 + inner),
    height:
      GROUP_HEADER + (rows === 0 ? GROUP_PAD : rows * CELL_H + (rows - 1) * CELL_GAP + GROUP_PAD),
  };
};

const memberBoxes = (
  members: readonly GraphViewNode[],
  origin: { readonly x: number; readonly y: number },
  cols: number,
): MemberBox[] =>
  members.map((node, index) => ({
    node,
    x: origin.x + GROUP_PAD + (cols === 0 ? 0 : index % cols) * (CELL_W + CELL_GAP),
    y: origin.y + GROUP_HEADER + (cols === 0 ? 0 : Math.floor(index / cols)) * (CELL_H + CELL_GAP),
    width: CELL_W,
    height: CELL_H,
  }));

interface Row {
  readonly layer: number;
  readonly groups: readonly GraphViewGroup[];
  readonly sizes: readonly Size[];
  readonly width: number;
  readonly height: number;
}

const rowOf = (layer: number, groups: readonly GraphViewGroup[], sizes: readonly Size[]): Row => ({
  layer,
  groups,
  sizes,
  width:
    sizes.reduce((total, size) => total + size.width, 0) +
    Math.max(0, sizes.length - 1) * GROUP_GAP_X,
  height: sizes.reduce((tallest, size) => Math.max(tallest, size.height), 0),
});

/**
 * A layer with thirty packages in it would produce a diagram five thousand pixels wide, of which
 * a reader sees a sliver. Wrap it into sub-rows instead: the picture stays roughly page-shaped and
 * the text stays at its natural, readable size. Deterministic — the group order is already total.
 */
const wrapLayer = (
  layer: number,
  groups: readonly GraphViewGroup[],
  sizes: readonly Size[],
): Row[] => {
  const rows: Row[] = [];
  let pending: GraphViewGroup[] = [];
  let pendingSizes: Size[] = [];
  let width = 0;
  groups.forEach((group, index) => {
    const size = sizes[index] ?? sizeFor(0);
    const grown = width === 0 ? size.width : width + GROUP_GAP_X + size.width;
    if (grown > MAX_ROW_WIDTH && pending.length > 0) {
      rows.push(rowOf(layer, pending, pendingSizes));
      pending = [];
      pendingSizes = [];
      width = 0;
    }
    pending.push(group);
    pendingSizes.push(size);
    width = width === 0 ? size.width : width + GROUP_GAP_X + size.width;
  });
  if (pending.length > 0) {
    rows.push(rowOf(layer, pending, pendingSizes));
  }
  return rows;
};

const buildRows = (view: GraphView, layers: Map<string, number>): Row[] => {
  const memberCount = new Map<string, number>();
  for (const node of view.nodes) {
    memberCount.set(node.groupId, (memberCount.get(node.groupId) ?? 0) + 1);
  }
  const byLayer = new Map<number, GraphViewGroup[]>();
  for (const group of [...view.groups].sort((a, b) => a.label.localeCompare(b.label))) {
    const layer = layers.get(group.id) ?? 0;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), group]);
  }
  return [...byLayer.keys()]
    .sort((a, b) => a - b)
    .flatMap((layer) => {
      const groups = byLayer.get(layer) ?? [];
      return wrapLayer(
        layer,
        groups,
        groups.map((group) => sizeFor(memberCount.get(group.id) ?? 0)),
      );
    });
};

const placeRows = (view: GraphView, rows: readonly Row[], canvasWidth: number): GroupBox[] => {
  const membersByGroup = new Map<string, GraphViewNode[]>();
  for (const node of view.nodes) {
    membersByGroup.set(node.groupId, [...(membersByGroup.get(node.groupId) ?? []), node]);
  }
  const boxes: GroupBox[] = [];
  let y = MARGIN;
  rows.forEach((row, rowIndex) => {
    let x = MARGIN + Math.round((canvasWidth - 2 * MARGIN - row.width) / 2);
    row.groups.forEach((group, index) => {
      const size = row.sizes[index] ?? sizeFor(0);
      const origin = { x, y };
      boxes.push({
        group,
        layer: row.layer,
        row: rowIndex,
        ...origin,
        width: size.width,
        height: size.height,
        members: memberBoxes(membersByGroup.get(group.id) ?? [], origin, size.cols),
      });
      x += size.width + GROUP_GAP_X;
    });
    y += row.height + LAYER_GAP_Y;
  });
  return boxes;
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
  const widest = rows.reduce((width, row) => Math.max(width, row.width), MIN_GROUP_W);
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
