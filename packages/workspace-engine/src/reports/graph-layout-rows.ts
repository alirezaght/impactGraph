import type {
  GraphView,
  GraphViewGroup,
  GraphViewNode,
  GraphViewKind,
} from './graph-view-model.js';

// Row building and placement for the deterministic layered layout. Split out of `graph-layout.ts`
// so that file keeps a single responsibility (layering + edge routing) and neither exceeds the
// LOC budget.
//
// The ONLY thing the view's `kind` changes here is the cell size: an impact cell carries a
// likelihood meter, a confidence figure and a hop count, so it needs more room than an
// architecture cell. Everything else — ordering, wrapping, placement — is identical, which is the
// point of having one renderer.

export const MARGIN = 48;
export const GROUP_GAP_X = 44;
export const LAYER_GAP_Y = 116;
const GROUP_PAD = 14;
const GROUP_HEADER = 64;
const CELL_GAP = 10;
const MIN_GROUP_W = 244;
/** Wrap a too-wide layer rather than emitting a diagram nobody can see the whole of. */
const MAX_ROW_WIDTH = 1500;

export interface CellMetrics {
  readonly width: number;
  readonly height: number;
  readonly maxCols: number;
}

const CELL_METRICS: Readonly<Record<GraphViewKind, CellMetrics>> = {
  architecture: { width: 176, height: 52, maxCols: 4 },
  // Taller and wider: name + type/provenance badge + likelihood meter with its spelled-out word +
  // confidence to two decimals + directness and hop count all have to fit without clipping.
  impact: { width: 232, height: 92, maxCols: 3 },
};

export const metricsFor = (kind: GraphViewKind): CellMetrics => CELL_METRICS[kind];

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

interface Size {
  readonly cols: number;
  readonly width: number;
  readonly height: number;
}

const sizeFor = (memberCount: number, cell: CellMetrics): Size => {
  const cols = memberCount === 0 ? 0 : Math.min(cell.maxCols, Math.ceil(Math.sqrt(memberCount)));
  const rows = cols === 0 ? 0 : Math.ceil(memberCount / cols);
  const inner = cols === 0 ? 0 : cols * cell.width + (cols - 1) * CELL_GAP;
  return {
    cols,
    width: Math.max(MIN_GROUP_W, GROUP_PAD * 2 + inner),
    height:
      GROUP_HEADER +
      (rows === 0 ? GROUP_PAD : rows * cell.height + (rows - 1) * CELL_GAP + GROUP_PAD),
  };
};

const memberBoxes = (
  members: readonly GraphViewNode[],
  origin: { readonly x: number; readonly y: number },
  cols: number,
  cell: CellMetrics,
): MemberBox[] =>
  members.map((node, index) => ({
    node,
    x: origin.x + GROUP_PAD + (cols === 0 ? 0 : index % cols) * (cell.width + CELL_GAP),
    y:
      origin.y +
      GROUP_HEADER +
      (cols === 0 ? 0 : Math.floor(index / cols)) * (cell.height + CELL_GAP),
    width: cell.width,
    height: cell.height,
  }));

export interface Row {
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
 * A layer with thirty packages in it would produce a diagram five thousand pixels wide, of which a
 * reader sees a sliver. Wrap it into sub-rows instead: the picture stays roughly page-shaped and the
 * text stays at its natural, readable size. Deterministic — the group order is already total.
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
    const size = sizes[index] ?? { cols: 0, width: MIN_GROUP_W, height: GROUP_HEADER };
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

export const buildRows = (view: GraphView, layers: Map<string, number>): Row[] => {
  const cell = metricsFor(view.kind);
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
        groups.map((group) => sizeFor(memberCount.get(group.id) ?? 0, cell)),
      );
    });
};

export const placeRows = (
  view: GraphView,
  rows: readonly Row[],
  canvasWidth: number,
): GroupBox[] => {
  const cell = metricsFor(view.kind);
  const membersByGroup = new Map<string, GraphViewNode[]>();
  for (const node of view.nodes) {
    membersByGroup.set(node.groupId, [...(membersByGroup.get(node.groupId) ?? []), node]);
  }
  const boxes: GroupBox[] = [];
  let y = MARGIN;
  rows.forEach((row, rowIndex) => {
    let x = MARGIN + Math.round((canvasWidth - 2 * MARGIN - row.width) / 2);
    row.groups.forEach((group, index) => {
      const size = row.sizes[index] ?? { cols: 0, width: MIN_GROUP_W, height: GROUP_HEADER };
      const origin = { x, y };
      boxes.push({
        group,
        layer: row.layer,
        row: rowIndex,
        ...origin,
        width: size.width,
        height: size.height,
        members: memberBoxes(membersByGroup.get(group.id) ?? [], origin, size.cols, cell),
      });
      x += size.width + GROUP_GAP_X;
    });
    y += row.height + LAYER_GAP_Y;
  });
  return boxes;
};

export const MIN_ROW_WIDTH = MIN_GROUP_W;
