import { evidenceTypesOf, primaryEvidenceType } from '@impactgraph/domain';

import { groupByNode, selectImpacts } from './impact-selection.js';

import type { GroupedImpact } from './impact-selection.js';
import type { CliImpactPage, ImpactFilters } from '@impactgraph/contracts';
import type {
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  Specification,
} from '@impactgraph/domain';

// The follow-up detail page the bounded summary points at (item 9). Same filters, same ranking,
// same cursor — but with the dependency path, the evidence basis set, and the §14 signals, which
// is the material a reader needs once they have decided which impact to look at.

export interface ImpactPageInput {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly evidenceFileById?: ReadonlyMap<string, string> | undefined;
  readonly filters?: ImpactFilters;
}

const DEFAULT_PAGE_SIZE = 50;

const rowFor = (
  entry: GroupedImpact,
  input: ImpactPageInput,
  includeFullPaths: boolean,
): CliImpactPage['impacts'][number] => {
  const { impact } = entry;
  const node = input.graph.nodes.get(impact.nodeId as NodeId);
  const evidenceTypes = evidenceTypesOf(impact);
  const evidenceFiles =
    input.evidenceFileById === undefined
      ? undefined
      : [
          ...new Set(
            impact.evidenceIds
              .map((id) => input.evidenceFileById?.get(id))
              .filter((file): file is string => file !== undefined),
          ),
        ];
  return {
    nodeId: impact.nodeId,
    name: node?.name ?? impact.nodeId,
    ...(node?.path === undefined || !includeFullPaths ? {} : { path: node.path }),
    likelihood: impact.likelihood,
    evidenceType: primaryEvidenceType(evidenceTypes),
    impactType: impact.impactType,
    confidence: impact.confidence,
    hops: Math.max(0, impact.dependencyPath.length - 1),
    requirementIds: [...new Set(entry.requirementIds)].sort(),
    requirementLabels: [...new Set(entry.requirementLabels)].sort(),
    reason: impact.explanation,
    ...(impact.tierCappedBy === undefined ? {} : { tierCappedBy: impact.tierCappedBy }),
    dependencyPath: [...impact.dependencyPath],
    evidenceTypes: [...evidenceTypes],
    ...(evidenceFiles === undefined ? {} : { evidenceFiles }),
    confidenceSignals: impact.confidenceSignals.map((signal) => ({
      type: signal.type,
      contribution: signal.contribution,
    })),
  };
};

export const buildImpactPage = (input: ImpactPageInput): CliImpactPage => {
  const filters: ImpactFilters = { topN: DEFAULT_PAGE_SIZE, ...input.filters };
  const selection = selectImpacts(input.analysis, filters);
  const grouped = groupByNode(selection.impacts, input.specification);
  const includeFullPaths = filters.includeFullPaths ?? true;
  return {
    schemaVersion: 1,
    command: 'impacts',
    analysisId: input.analysis.id,
    impacts: grouped.map((entry) => rowFor(entry, input, includeFullPaths)),
    pagination: {
      returned: grouped.length,
      totalMatching: selection.totalMatching,
      ...(selection.nextCursor === undefined ? {} : { nextCursor: selection.nextCursor }),
      appliedFilters: selection.appliedFilters,
    },
    impactQuery: {
      status: selection.totalMatching === 0 ? 'completed-empty' : 'completed',
      scope: `the stored impact analysis ${input.analysis.id} (${String(input.analysis.requirementImpacts.length)} impacts) under the stated filters`,
      limitations:
        filters.includeLexicalOnly === true
          ? []
          : ['Lexical-only matches were excluded (includeLexicalOnly: true to see them).'],
      resultCount: selection.totalMatching,
    },
  };
};
