import type { CliImpactSummary } from '@impactgraph/contracts';
import type { ImpactAnalysis, KnowledgeGraph, NodeId, Specification } from '@impactgraph/domain';

/**
 * Artifact CATEGORIES an implementation of this specification will probably need (item 8: "New files
 * cannot be predicted by exact path, but ImpactGraph should predict artifact categories").
 *
 * The honest form of a new-file prediction. `src/locales/de/nda.json` for a file that does not exist
 * is an invented node in everything but name; "this change will need a new locale entry — here are
 * the three bundles that already exist" is a checkable statement grounded in indexed artifacts.
 *
 * Every prediction is therefore gated on BOTH a cue in the specification and existing artifacts of
 * that kind in the repository. No artifacts of the kind → no prediction, because there would be
 * nowhere to point.
 */

type PredictedArtifact = CliImpactSummary['predictedArtifacts'][number];

interface Rule {
  readonly category: PredictedArtifact['category'];
  /** A cue in the requirement text. */
  readonly cue: RegExp;
  /** Node types that count as an existing example of this artifact kind. */
  readonly nodeTypes: readonly string[];
  readonly reason: string;
}

const RULES: readonly Rule[] = [
  {
    category: 'new-locale-entry',
    cue: /\b(locale|translation|i18n|message text|copy|subject line|wording|language)\b/i,
    nodeTypes: ['locale-bundle', 'translation-key'],
    reason:
      'the specification concerns user-visible message text, and this repository keeps such text in locale bundles',
  },
  {
    category: 'new-test',
    cue: /\b(must|should|shall)\b/i,
    nodeTypes: ['test'],
    reason: 'the specification states observable behaviour, which this repository covers with tests',
  },
  {
    category: 'new-event-handler',
    cue: /\b(event|topic|subscription|publish|subscribe|consume|outbox|queue|push route)\b/i,
    nodeTypes: ['consumer', 'subscription', 'pubsub-subscription', 'push-endpoint', 'handler'],
    reason:
      'the specification concerns an event flow, and a new event type usually needs a handler on the consuming side',
  },
  {
    category: 'new-migration',
    cue: /\b(column|table|schema|field|persist|store|database|nullable|index)\b/i,
    nodeTypes: ['migration'],
    reason:
      'the specification changes persisted data, and this repository evolves its schema through migrations',
  },
  {
    category: 'new-contract-definition',
    cue: /\b(contract|api|endpoint|payload|schema|openapi|event definition|dto)\b/i,
    nodeTypes: ['openapi-document', 'openapi-operation', 'json-schema', 'event-definition'],
    reason:
      'the specification changes a cross-boundary payload, and this repository declares those in contract documents',
  },
  {
    category: 'new-configuration-entry',
    cue: /\b(config|configuration|environment variable|feature flag|terraform|deploy)\b/i,
    nodeTypes: ['configuration-file', 'terraform-resource', 'environment-variable'],
    reason:
      'the specification implies a configuration change, and this repository keeps configuration in committed files',
  },
];

const EXAMPLE_LIMIT = 3;

const examplesOf = (
  graph: KnowledgeGraph,
  nodeTypes: readonly string[],
  preferredPaths: ReadonlySet<string>,
): readonly string[] => {
  const matching: string[] = [];
  for (const node of graph.nodes.values()) {
    if (nodeTypes.includes(node.type) && node.path !== undefined) {
      matching.push(node.path);
    }
  }
  // Prefer artifacts already inside the predicted area: a locale bundle the analysis already
  // reached is a much better pointer than an arbitrary one from elsewhere in the monorepo.
  const sorted = [...new Set(matching)].sort((a, b) => {
    const preference = Number(preferredPaths.has(b)) - Number(preferredPaths.has(a));
    return preference !== 0 ? preference : a.localeCompare(b);
  });
  return sorted.slice(0, EXAMPLE_LIMIT);
};

export const predictArtifacts = (
  specification: Specification,
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
  predictedPaths: ReadonlySet<string>,
): readonly PredictedArtifact[] => {
  const text = specification.requirements.map((requirement) => requirement.statement).join('\n');
  const predictions: PredictedArtifact[] = [];
  for (const rule of RULES) {
    if (!rule.cue.test(text)) {
      continue;
    }
    const examplePaths = examplesOf(graph, rule.nodeTypes, predictedPaths);
    if (examplePaths.length === 0) {
      // No artifacts of this kind exist, so there is nowhere to point and nothing to claim.
      continue;
    }
    predictions.push({ category: rule.category, reason: rule.reason, examplePaths: [...examplePaths] });
  }
  return predictions;
};

/** Paths of nodes an impact points at — used to prefer nearby examples. */
export const impactedPaths = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): ReadonlySet<string> => {
  const paths = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    const path = graph.nodes.get(impact.nodeId as NodeId)?.path;
    if (path !== undefined) {
      paths.add(path);
    }
  }
  return paths;
};
