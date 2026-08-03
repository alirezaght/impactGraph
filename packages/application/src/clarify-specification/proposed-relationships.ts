import { computeProposedRelationshipConfidence, stableContentId } from '@impactgraph/domain';

import type { CoChangeIndex } from '../history/co-change-index.js';
import type {
  ArchitecturalOption,
  GraphNode,
  ImpactSignalInput,
  KnowledgeGraph,
  NodeId,
  ProposedRelationship,
} from '@impactgraph/domain';

// §18.4 "display current and proposed relationships" + §26 "new dependencies" per option.
//
// WHAT IS DERIVED, AND FROM WHAT EVIDENCE
// An architectural option's footprint is the set of components one reading of the requirement
// would touch. When that footprint contains an event PAIR — something that runs code, and a
// topic/queue/subscription — and the deterministic graph has NO relationship between them, the
// option implies creating one. Three deterministic facts carry it:
//   1. the two node TYPES (§12.1), which encode the role: a `topic` is published TO, a
//      `subscription` is subscribed TO. Direction is fixed by the vocabulary, not guessed.
//   2. the ABSENCE of any path of length <= 2 between them at the bound snapshot — a positive
//      graph fact, since publish/subscribe call sites are what the framework adapters detect.
//   3. git co-change between the two files, when it exists (§14).
// The remaining half — that these two components belong to ONE coherent change — comes from a
// model-authored interpretation, which is why the record is `llm-inferred` and carries an
// `unsupported-inference` penalty. Both endpoints are always existing graph nodes, so the
// §34 grounding rule holds by construction and is re-checked by the domain gate.
//
// DELIBERATELY NOT DERIVED (see docs/engineering/data-contracts.md):
//   - data relationships (READS_FROM / WRITES_TO): the node types do not fix the direction.
//   - DEPLOYED_AS / MIGRATES: an unlinked (service, cloud-run-service) or (migration, table)
//     pair is far more likely an indexing gap than an architectural proposal.
//   - proposed NODES: a component that does not exist has no evidence record to cite, and the
//     only available signal — an unmatched concept string — cannot be told apart from an alias
//     gap (§17). Those surface as `unknown-concept` warnings instead.

/** Node types that can hold the code performing a publish or subscribe. */
const PUBLISHER_TYPES: ReadonlySet<string> = new Set([
  'application',
  'service',
  'module',
  'class',
  'function',
  'method',
  'handler',
  'job',
  'controller',
]);

/** Target type → the §12.2 relationship its role implies. Closed table; no fallback guess. */
const EVENT_TARGET_RULES: Readonly<Record<string, 'PUBLISHES' | 'SUBSCRIBES_TO'>> = {
  topic: 'PUBLISHES',
  queue: 'PUBLISHES',
  'pubsub-topic': 'PUBLISHES',
  subscription: 'SUBSCRIBES_TO',
  'pubsub-subscription': 'SUBSCRIBES_TO',
};

/** Bounds the pair scan; a footprint this wide is a modelling problem, not a proposal set. */
const MAX_PROPOSALS_PER_OPTION = 10;
const MAX_EVIDENCE_IDS = 6;

const neighboursOf = (graph: KnowledgeGraph, id: string): Set<string> => {
  const found = new Set<string>();
  const edgeIds = [
    ...(graph.outgoing.get(id as NodeId) ?? []),
    ...(graph.incoming.get(id as NodeId) ?? []),
  ];
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge !== undefined) {
      found.add(edge.sourceId === id ? edge.targetId : edge.sourceId);
    }
  }
  return found;
};

/** True when the graph already relates the two nodes directly or through one intermediary. */
const relatedWithinTwoHops = (graph: KnowledgeGraph, from: string, to: string): boolean => {
  const direct = neighboursOf(graph, from);
  if (direct.has(to)) {
    return true;
  }
  for (const middle of direct) {
    if (neighboursOf(graph, middle).has(to)) {
      return true;
    }
  }
  return false;
};

interface PairContext {
  readonly graph: KnowledgeGraph;
  readonly option: ArchitecturalOption;
  readonly coChange: CoChangeIndex;
}

const signalsFor = (
  context: PairContext,
  source: GraphNode,
  target: GraphNode,
): ImpactSignalInput[] => {
  const signals: ImpactSignalInput[] = [
    {
      type: 'framework-convention',
      description: `§12.1 node type '${target.type}' fixes the direction of the relationship`,
    },
    {
      type: 'event-relationship',
      description: `'${source.name}' and '${target.name}' form an event pair the graph does not connect`,
    },
    { type: 'graph-distance', description: 'no path of length <= 2 exists between them today' },
    {
      type: 'unsupported-inference',
      description: 'the interpretation pairing these components is AI-assisted (§26)',
    },
  ];
  const coChanges =
    source.path !== undefined && target.path !== undefined
      ? context.coChange.pairCount(source.path, target.path)
      : 0;
  if (coChanges > 0) {
    signals.push({
      type: 'historical-co-change',
      description: `changed together in ${String(coChanges)} of the last ${String(context.coChange.totalCommits)} commits`,
    });
  }
  return signals;
};

const proposalFor = (
  context: PairContext,
  source: GraphNode,
  target: GraphNode,
): ProposedRelationship | undefined => {
  const type = EVENT_TARGET_RULES[target.type];
  if (type === undefined || relatedWithinTwoHops(context.graph, source.id, target.id)) {
    return undefined;
  }
  const signals = signalsFor(context, source, target);
  const confidence = computeProposedRelationshipConfidence(signals);
  if (!confidence.ok) {
    return undefined;
  }
  return {
    id: stableContentId('proposed-rel', `${context.option.id}:${type}:${source.id}->${target.id}`),
    sourceId: source.id,
    targetId: target.id,
    sourceKind: 'existing',
    targetKind: 'existing',
    type,
    status: 'proposed',
    originOptionId: context.option.id,
    rationale: `Option '${context.option.title}' affects both '${source.name}' and '${target.name}', but the repository has no relationship between them — choosing it would add a ${type} relationship. AI-assisted (§26).`,
    provenance: 'llm-inferred',
    evidenceIds: [
      ...new Set([...source.knowledge.evidenceIds, ...target.knowledge.evidenceIds]),
    ].slice(0, MAX_EVIDENCE_IDS),
    confidence: confidence.value.value,
    confidenceSignals: confidence.value.signals,
  };
};

export interface ProposedRelationshipOutcome {
  readonly relationships: readonly ProposedRelationship[];
  /** Set when the pair scan hit its bound and stopped — a cutoff, never a silent truncation. */
  readonly cutoff: boolean;
}

/** Derive the relationships an option would CREATE, from its footprint and the current graph. */
export const deriveProposedRelationships = (
  graph: KnowledgeGraph,
  option: ArchitecturalOption,
  coChange: CoChangeIndex,
): ProposedRelationshipOutcome => {
  const context: PairContext = { graph, option, coChange };
  const nodes = option.affectedNodeIds
    .map((id) => graph.nodes.get(id as NodeId))
    .filter((node): node is GraphNode => node !== undefined);
  const sources = nodes.filter((node) => PUBLISHER_TYPES.has(node.type));
  const targets = nodes.filter((node) => EVENT_TARGET_RULES[node.type] !== undefined);
  const relationships: ProposedRelationship[] = [];
  for (const source of sources) {
    for (const target of targets) {
      if (relationships.length >= MAX_PROPOSALS_PER_OPTION) {
        return { relationships, cutoff: true };
      }
      const proposal = proposalFor(context, source, target);
      if (proposal !== undefined) {
        relationships.push(proposal);
      }
    }
  }
  return { relationships, cutoff: false };
};
