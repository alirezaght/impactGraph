import type { CliAnalyzeOutput } from '@impactgraph/contracts';

// Story 9.2/9.3 (tree half) — pure mapping from the versioned analyze document to tree data.
// No vscode types here: this file is unit-tested without Electron. Likelihood, impact type,
// confidence, and provenance are TEXT on every item — never color alone (§37, §3).

export interface ImpactTreeNode {
  readonly kind: 'requirement' | 'bucket' | 'impact' | 'detail' | 'file';
  readonly label: string;
  readonly description?: string | undefined;
  readonly tooltip?: string | undefined;
  /** Workspace-relative file to open when selected (evidence navigation, §18.5). */
  readonly filePath?: string | undefined;
  readonly children: readonly ImpactTreeNode[];
  /** Set on impact nodes so decision commands can act on the selection (9.4). */
  readonly impactRef?:
    { analysisId: string; requirementId: string; nodeId: string; name: string } | undefined;
}

const LIKELIHOOD_ORDER = ['required', 'likely', 'possible', 'unlikely'] as const;

type ImpactDto = CliAnalyzeOutput['requirements'][number]['impacts'][number];

const impactNode = (
  analysisId: string,
  requirementId: string,
  impact: ImpactDto,
): ImpactTreeNode => {
  const details: ImpactTreeNode[] = [
    { kind: 'detail', label: `type: ${impact.impactType} (${impact.directness})`, children: [] },
    {
      kind: 'detail',
      label: `confidence: ${impact.confidence.toFixed(2)}`,
      description: impact.provenance === undefined ? undefined : `provenance: ${impact.provenance}`,
      children: [],
    },
  ];
  if (impact.dependencyPath.length > 1) {
    details.push({
      kind: 'detail',
      label: `via: ${impact.dependencyPath.join(' → ')}`,
      children: [],
    });
  }
  for (const file of impact.evidenceFiles) {
    details.push({
      kind: 'file',
      label: file,
      description: 'evidence',
      filePath: file.startsWith('commit ') ? undefined : file,
      children: [],
    });
  }
  return {
    kind: 'impact',
    label: impact.name,
    description: `${impact.likelihood} · ${impact.impactType} · ${impact.confidence.toFixed(2)}${impact.provenance === undefined ? '' : ` · ${impact.provenance}`}`,
    tooltip: impact.name,
    children: details,
    impactRef: { analysisId, requirementId, nodeId: impact.nodeId, name: impact.name },
  };
};

/** Story 9.2 filters + grouping switch (§40.4, §18.4): pure state applied before mapping. */
export interface ImpactViewOptions {
  readonly likelihoods?: readonly string[] | undefined;
  readonly impactTypes?: readonly string[] | undefined;
  readonly grouping?: 'requirement' | 'impact-type' | undefined;
}

const passesFilters = (impact: ImpactDto, options: ImpactViewOptions): boolean =>
  (options.likelihoods === undefined || options.likelihoods.includes(impact.likelihood)) &&
  (options.impactTypes === undefined || options.impactTypes.includes(impact.impactType));

const byRequirement = (output: CliAnalyzeOutput, options: ImpactViewOptions): ImpactTreeNode[] =>
  output.requirements.map((requirement) => {
    const visible = requirement.impacts.filter((impact) => passesFilters(impact, options));
    return {
      kind: 'requirement' as const,
      label: requirement.statement,
      description: `${String(visible.length)} impact(s)`,
      tooltip: requirement.statement,
      children: LIKELIHOOD_ORDER.flatMap((likelihood) => {
        const impacts = visible.filter((impact) => impact.likelihood === likelihood);
        if (impacts.length === 0) {
          return [];
        }
        return [
          {
            kind: 'bucket' as const,
            label: likelihood,
            description: String(impacts.length),
            children: impacts.map((impact) =>
              impactNode(output.analysis.id, requirement.id, impact),
            ),
          },
        ];
      }),
    };
  });

const byImpactType = (output: CliAnalyzeOutput, options: ImpactViewOptions): ImpactTreeNode[] => {
  const groups = new Map<string, ImpactTreeNode[]>();
  for (const requirement of output.requirements) {
    for (const impact of requirement.impacts) {
      if (!passesFilters(impact, options)) {
        continue;
      }
      const nodes = groups.get(impact.impactType) ?? [];
      nodes.push(impactNode(output.analysis.id, requirement.id, impact));
      groups.set(impact.impactType, nodes);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([impactType, children]) => ({
      kind: 'bucket' as const,
      label: impactType,
      description: String(children.length),
      children,
    }));
};

/** Specification → Requirement → likelihood buckets → impacts (§18.3 default hierarchy). */
export const buildImpactItems = (
  output: CliAnalyzeOutput,
  options: ImpactViewOptions = {},
): ImpactTreeNode[] =>
  options.grouping === 'impact-type'
    ? byImpactType(output, options)
    : byRequirement(output, options);

export const impactHeadline = (output: CliAnalyzeOutput): string =>
  `${output.specification.title} v${String(output.specification.version)} — analysis ${output.analysis.id} (${output.analysis.status}, ${String(output.analysis.impactCount)} impacts)`;
