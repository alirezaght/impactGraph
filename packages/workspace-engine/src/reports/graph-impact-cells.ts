import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import { PROPOSED_GROUP_LABEL, UNASSIGNED_GROUP_LABELS } from './graph-impact-model.js';
import { byImpactPriority, hopsOf } from './graph-impact-rows.js';
import { likelihoodRank } from './graph-impact-style.js';
import { emptyCategoryCounts } from './graph-render-category.js';
import { countByGroup, rankGroupIds, selectRoundRobin } from './graph-view-budget.js';

import type { ImpactNodeFacts } from './graph-impact-model.js';
import type { RenderCategory } from './graph-render-category.js';
import type {
  GraphGrouping,
  GraphViewBudget,
  GraphViewGroup,
  GraphViewNode,
} from './graph-view-model.js';
import type { ImpactAnalysis, RequirementImpact } from '@impactgraph/domain';

// Cell construction and the §33 budget for the impact view: which components become boxes, which
// group each lands in, and which survive the node cap. One cell per impacted COMPONENT — a
// component impacted by three requirements is one box showing its strongest claim, plus three rows
// in the impacts table.

/** Component facts the graph supplies. `missing` marks an id the resolved graph does not contain. */
export interface ComponentFacts {
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly path?: string | undefined;
  readonly provenance: string;
  readonly missing?: boolean | undefined;
}

const categoryOf = (provenance: string): RenderCategory =>
  knowledgeCategoryForProvenance(provenance) ?? 'unknown';

const derivedFacts = (nodeId: string): ComponentFacts => {
  const colon = nodeId.indexOf(':');
  const prefix = colon === -1 ? 'node' : nodeId.slice(0, colon);
  const body = colon === -1 ? nodeId : nodeId.slice(colon + 1);
  const hash = body.lastIndexOf('#');
  const filePart = hash === -1 ? body : body.slice(0, hash);
  const name = hash === -1 ? (filePart.split('/').pop() ?? body) : body.slice(hash + 1);
  return {
    name: name.length === 0 ? nodeId : name,
    type: prefix,
    category: 'unknown',
    // Only `file:` and `symbol:` ids embed a repository-relative path; nothing else is assumed.
    ...(prefix === 'file' || prefix === 'symbol' ? { path: filePart } : {}),
    provenance: 'unknown',
    missing: true,
  };
};

/**
 * Name/type/path for a node the analysis cites. When the resolved graph has no such node the facts
 * are derived from the id and FLAGGED — a stale analysis must read as stale, never as thin.
 */
export const factsFor = (
  nodeId: string,
  components: ReadonlyMap<string, ComponentFacts>,
): ComponentFacts => components.get(nodeId) ?? derivedFacts(nodeId);

/** Aggregate one component's impacts into the facts drawn on its cell. */
const nodeFactsFor = (impacts: readonly RequirementImpact[], missing: boolean): ImpactNodeFacts => {
  const ordered = [...impacts].sort(byImpactPriority);
  const leader = ordered[0];
  const hops = ordered.map(hopsOf);
  const directness = new Set(ordered.map((impact) => impact.directness));
  return {
    likelihood: leader?.likelihood ?? 'unlikely',
    confidence: Math.max(...ordered.map((impact) => impact.confidence)),
    impactTypes: [...new Set(ordered.map((impact) => impact.impactType))],
    directness: directness.size > 1 ? 'mixed' : (leader?.directness ?? 'indirect'),
    minHops: Math.min(...hops),
    maxHops: Math.max(...hops),
    requirementIds: [...new Set(ordered.map((impact) => impact.requirementId))],
    impactCount: ordered.length,
    missingFromSnapshot: missing,
  };
};

export interface CellInput {
  readonly grouping: GraphGrouping;
  readonly analysis: ImpactAnalysis;
  readonly components: ReadonlyMap<string, ComponentFacts>;
  readonly groupOf: ReadonlyMap<string, string>;
  readonly maxVisibleNodes: number;
}

/** Absent grouping reads as absent (§Z5): labelled unassigned, never blank, never guessed. */
export const groupLabelFor = (input: CellInput, nodeId: string): string =>
  input.groupOf.get(nodeId) ?? UNASSIGNED_GROUP_LABELS[input.grouping];

const impactCells = (input: CellInput): GraphViewNode[] => {
  const byNode = new Map<string, RequirementImpact[]>();
  for (const impact of input.analysis.requirementImpacts) {
    byNode.set(impact.nodeId, [...(byNode.get(impact.nodeId) ?? []), impact]);
  }
  return [...byNode.entries()].map(([nodeId, impacts]) => {
    const facts = factsFor(nodeId, input.components);
    // The provenance shown is the provenance of the IMPACT CLAIM, not of the component: what a
    // reader must judge here is how the prediction was produced (§3).
    const provenance = impacts[0]?.provenance ?? facts.provenance;
    return {
      id: nodeId,
      groupId: groupLabelFor(input, nodeId),
      name: facts.name,
      type: facts.type,
      category: facts.category,
      ...(facts.path === undefined ? {} : { path: facts.path }),
      provenance,
      knowledgeCategory: categoryOf(provenance),
      impact: nodeFactsFor(impacts, facts.missing === true),
    };
  });
};

/**
 * §18.4: components an architectural option WOULD create. They get their own group — they group
 * with each other and never into a real bounded context, because they are not in the repository.
 */
const proposedCells = (analysis: ImpactAnalysis): GraphViewNode[] =>
  (analysis.proposedStructure?.nodes ?? []).map((node) => ({
    id: node.id,
    groupId: PROPOSED_GROUP_LABEL,
    name: node.name,
    type: node.type,
    category: node.category,
    provenance: node.provenance,
    knowledgeCategory: categoryOf(node.provenance),
    proposed: true,
  }));

/** Strongest claim first; proposed components sort after every impact, never among them. */
const byCellPriority = (a: GraphViewNode, b: GraphViewNode): number =>
  rankOf(a) - rankOf(b) ||
  (b.impact?.confidence ?? 0) - (a.impact?.confidence ?? 0) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);

const rankOf = (node: GraphViewNode): number =>
  node.impact === undefined ? 4 : likelihoodRank(node.impact.likelihood);

interface GroupTally {
  readonly members: GraphViewNode[];
  readonly counts: Record<RenderCategory, number>;
}

const tallyGroups = (cells: readonly GraphViewNode[]): Map<string, GroupTally> => {
  const tallies = new Map<string, GroupTally>();
  for (const cell of cells) {
    const tally = tallies.get(cell.groupId) ?? { members: [], counts: emptyCategoryCounts() };
    tallies.set(cell.groupId, tally);
    tally.members.push(cell);
    tally.counts[cell.knowledgeCategory] += 1;
  }
  return tallies;
};

const groupRecord = (id: string, tally: GroupTally, shown: number): GraphViewGroup => ({
  id,
  label: id,
  totalNodes: tally.members.length,
  shownNodes: shown,
  hiddenNodes: tally.members.length - shown,
  countsByKnowledgeCategory: { ...tally.counts },
});

export interface CellPlan {
  readonly nodes: readonly GraphViewNode[];
  readonly groups: readonly GraphViewGroup[];
  readonly budget: GraphViewBudget;
  readonly drawnGroupIds: ReadonlySet<string>;
  /** Impacted components before the cap — excludes proposed components, which are not impacts. */
  readonly impactedComponentCount: number;
  readonly impactedComponentsShown: number;
}

/** Groups claim the budget first (they are the structure), members fill the remainder. */
export const planImpactCells = (input: CellInput): CellPlan => {
  const impacted = impactCells(input);
  const cells = [...impacted, ...proposedCells(input.analysis)].sort(byCellPriority);
  const tallies = tallyGroups(cells);
  const ranked = rankGroupIds(new Map([...tallies].map(([id, t]) => [id, t.members.length])));
  const drawnGroupIds = new Set(ranked.slice(0, input.maxVisibleNodes));
  const nodes = selectRoundRobin(
    [...drawnGroupIds].map((id) => tallies.get(id)?.members ?? []),
    Math.max(0, input.maxVisibleNodes - drawnGroupIds.size),
  );
  const shownPerGroup = countByGroup(nodes);
  return {
    nodes,
    groups: [...drawnGroupIds].map((id) =>
      groupRecord(
        id,
        tallies.get(id) ?? { members: [], counts: emptyCategoryCounts() },
        shownPerGroup.get(id) ?? 0,
      ),
    ),
    budget: {
      maxVisibleNodes: input.maxVisibleNodes,
      graphNodes: input.components.size,
      architectureNodes: cells.length,
      shownNodes: nodes.length,
      hiddenNodes: cells.length - nodes.length,
      groups: tallies.size,
      groupsShown: drawnGroupIds.size,
      groupsHidden: tallies.size - drawnGroupIds.size,
      truncated: cells.length > nodes.length || tallies.size > drawnGroupIds.size,
    },
    drawnGroupIds,
    impactedComponentCount: impacted.length,
    impactedComponentsShown: nodes.filter((node) => node.impact !== undefined).length,
  };
};
