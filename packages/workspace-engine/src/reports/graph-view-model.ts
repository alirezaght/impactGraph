import type { ImpactNodeFacts, ImpactViewFacts } from './graph-impact-model.js';
import type { CategoryCounts, RenderCategory } from './graph-render-category.js';

// The read model behind `impactgraph graph` / `export_graph_html` (PRD §18.3/§18.6, §33).
//
// One shape, TWO view sources:
//   * `architecture` — a projection of the current deterministic graph at the architecture level:
//     groups (bounded context / application / package) with the aggregated relationships between
//     them (`graph-view.ts`);
//   * `impact` — a projection of a stored impact analysis: the components a specification is
//     predicted to touch, in the same groups, with likelihood as the primary signal
//     (`graph-impact-view.ts`).
//
// The `kind` discriminant exists so the layout, the SVG emitter and the HTML shell stay single
// implementations: they read the discriminant where the two views genuinely differ (cell size,
// cell contents, which sections the document carries) instead of each growing a second code path.
//
// Both projections deliberately carry names, types, paths, provenance and counts — never source
// text and never evidence excerpts, because the rendered file is meant to be attachable to a
// ticket.

export const GRAPH_VIEW_KINDS = ['architecture', 'impact'] as const;

export type GraphViewKind = (typeof GRAPH_VIEW_KINDS)[number];

/**
 * §18.4 current-vs-proposed. A `proposed` relationship is one an architectural option WOULD
 * create; it is never merged with a current one — aggregation keys on this field, so the two
 * halves cannot collapse into a single arrow (§3).
 */
export const GRAPH_EDGE_STATUSES = ['current', 'proposed'] as const;

export type GraphEdgeStatus = (typeof GRAPH_EDGE_STATUSES)[number];

/** Grouping keys, in the §18.4 order: context first, application as the alternative. */
export const GRAPH_GROUPINGS = ['context', 'application', 'package'] as const;

export type GraphGrouping = (typeof GRAPH_GROUPINGS)[number];

export const isGraphGrouping = (value: string): value is GraphGrouping =>
  (GRAPH_GROUPINGS as readonly string[]).includes(value);

/**
 * PRD §33 first-paint budget. Deliberately the same number the webview enforces
 * (`MAX_VISIBLE_NODES` in apps/vscode-extension/webview/src/graph/disclosure.ts): a static
 * export that drew more than the interactive view could is not a legible architecture picture.
 */
export const MAX_VISIBLE_NODES = 200;

/** Companion budget: aggregated relationships drawn as paths. Excess is reported, never dropped. */
export const MAX_VISIBLE_EDGES = 300;

/** Nodes that resolve to no group are collected here — never guessed into one (§Z5). */
export const UNGROUPED_LABEL = '(ungrouped)';

// §3/§43.6 — the knowledge categories, re-exported so existing importers keep one import site.
export { RENDER_CATEGORIES, emptyCategoryCounts } from './graph-render-category.js';
export type { CategoryCounts, RenderCategory } from './graph-render-category.js';

/** One drawn component. `path` is repository-relative; absolute paths never enter the view. */
export interface GraphViewNode {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly path?: string | undefined;
  readonly provenance: string;
  readonly knowledgeCategory: RenderCategory;
  /**
   * Present only in an `impact` view. Its presence is what tells the SVG emitter to draw the
   * impact cell (likelihood meter, confidence, hops) instead of the plain architecture cell.
   */
  readonly impact?: ImpactNodeFacts | undefined;
  /**
   * §18.4: a component an architectural option WOULD create. It does not exist in the repository,
   * carries no impact facts, and is drawn with the long-dash + `[PROPOSED]` treatment.
   */
  readonly proposed?: boolean | undefined;
}

export interface GraphViewGroup {
  readonly id: string;
  readonly label: string;
  /** Every graph node assigned to this group, at every level — not just the drawn ones. */
  readonly totalNodes: number;
  readonly shownNodes: number;
  readonly hiddenNodes: number;
  readonly countsByKnowledgeCategory: CategoryCounts;
}

export interface GraphViewEdgeKind {
  readonly type: string;
  readonly count: number;
}

/**
 * An aggregated group-to-group relationship. Aggregation NEVER crosses knowledge categories:
 * a deterministic import and an AI-inferred one produce two edges, so §3 separation survives
 * the roll-up. `kinds` keeps the individual edge types with their counts (`IMPORTS ×12`).
 *
 * Nor does aggregation cross `status`: a current relationship and a proposed one between the same
 * pair of groups are two separate arrows, drawn differently and labelled differently (§18.4).
 */
export interface GraphViewEdge {
  readonly sourceGroupId: string;
  readonly targetGroupId: string;
  readonly knowledgeCategory: RenderCategory;
  readonly status: GraphEdgeStatus;
  readonly kinds: readonly GraphViewEdgeKind[];
  readonly count: number;
}

export interface GraphViewBudget {
  readonly maxVisibleNodes: number;
  /** Nodes in the deterministic graph, all levels (files, symbols, everything). */
  readonly graphNodes: number;
  /** Nodes eligible at the architecture level, before the budget is applied. */
  readonly architectureNodes: number;
  readonly shownNodes: number;
  readonly hiddenNodes: number;
  readonly groups: number;
  readonly groupsShown: number;
  readonly groupsHidden: number;
  readonly truncated: boolean;
}

export interface GraphViewEdgeTotals {
  readonly graphEdges: number;
  /** CONTAINS edges — the containment scaffolding the group boxes already express. */
  readonly containment: number;
  readonly intraGroup: number;
  readonly interGroup: number;
  readonly aggregated: number;
  readonly aggregatedShown: number;
  readonly truncated: boolean;
}

export interface GraphView {
  readonly kind: GraphViewKind;
  readonly snapshotId: string;
  readonly grouping: GraphGrouping;
  readonly groups: readonly GraphViewGroup[];
  readonly nodes: readonly GraphViewNode[];
  readonly edges: readonly GraphViewEdge[];
  readonly budget: GraphViewBudget;
  readonly edgeTotals: GraphViewEdgeTotals;
  /** Present exactly when `kind === 'impact'`. */
  readonly impact?: ImpactViewFacts | undefined;
}

/**
 * Node types that read as architecture. Excluded on purpose: `file`/`symbol`/`directory` and the
 * fine-grained `class`/`interface`/`function`/`method`/`test` levels (they are the §18.4
 * drill-down, and they are what turns 3,000 nodes into an unreadable picture), the structural
 * `repository`/`workspace`/`package` types (they BECOME the groups), and the `intent` category
 * (specification knowledge, not repository architecture).
 */
export const ARCHITECTURE_NODE_TYPES: ReadonlySet<string> = new Set([
  'domain',
  'bounded-context',
  'aggregate',
  'entity',
  'value-object',
  'policy',
  'invariant',
  'command',
  'query',
  'domain-event',
  'application',
  'service',
  'module',
  'api-endpoint',
  'controller',
  'handler',
  'job',
  'cli-command',
  'ui-component',
  'page',
  'form',
  'database',
  'schema',
  'table',
  'collection',
  'column',
  'index',
  'migration',
  'cache',
  'search-index',
  'topic',
  'queue',
  'subscription',
  'publisher',
  'consumer',
  'webhook',
  'external-api',
  'third-party-service',
  'terraform-module',
  'terraform-resource',
  'cloud-run-service',
  'cloud-run-job',
  'gcp-project',
  'pubsub-topic',
  'pubsub-subscription',
  'service-account',
  'iam-role',
  'secret',
  'environment-variable',
  'docker-image',
  'deployment-pipeline',
]);
