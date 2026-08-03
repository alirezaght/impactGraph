import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { CustomDetectionRuleDto } from '@impactgraph/contracts';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Story 14.6 — the §Z8 custom-detection interpreter. Rules come from committed configuration
// (rules.yml `detections`), so every emitted fact carries `configuration` provenance — clearly
// distinguished from the built-in adapters' `framework-convention`. Invalid vocabulary in a
// rule degrades to a warning via the fragment builder, never a crash.

const fileImportsAny = (
  graph: CodeGraph,
  filePath: string,
  specifiers: readonly string[],
): boolean =>
  graph
    .importsOf(filePath)
    .some((importRef) => specifiers.some((specifier) => importRef.specifier === specifier));

interface Production {
  readonly sourceNodeId: string;
  readonly name: string | undefined;
  readonly filePath: string;
  readonly evidenceId: string;
}

const decoratorProductions = (graph: CodeGraph, rule: CustomDetectionRuleDto): Production[] =>
  graph.decorators
    .filter(
      (fact) =>
        (rule.match.decorators ?? []).includes(fact.decoratorName) &&
        fileImportsAny(graph, fact.filePath, rule.match.imports),
    )
    .map((fact) => ({
      sourceNodeId: fact.targetNodeId,
      name: fact.stringArguments[rule.produces.nameArgument ?? 0],
      filePath: fact.filePath,
      evidenceId: fact.evidenceId,
    }));

const callProductions = (graph: CodeGraph, rule: CustomDetectionRuleDto): Production[] =>
  graph.callFacts
    .filter(
      (fact) =>
        (rule.match.calls ?? []).includes(fact.calleeName) &&
        fileImportsAny(graph, fact.filePath, rule.match.imports),
    )
    .map((fact) => ({
      sourceNodeId: `file:${fact.filePath}`,
      name: fact.stringArguments[rule.produces.nameArgument ?? 0],
      filePath: fact.filePath,
      evidenceId: fact.evidenceId,
    }));

const emitRule = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  rule: CustomDetectionRuleDto,
  context: IndexingContext,
): void => {
  for (const production of [
    ...decoratorProductions(graph, rule),
    ...callProductions(graph, rule),
  ]) {
    if (production.name === undefined) {
      builder.warn(
        production.filePath,
        `custom rule '${rule.id}': no string argument at position ${String(rule.produces.nameArgument ?? 0)}`,
      );
      continue;
    }
    const nodeId = `custom:${rule.id}:${production.name}`;
    const node = builder.addNode(
      {
        id: nodeId,
        category: rule.produces.nodeCategory,
        type: rule.produces.nodeType,
        name: production.name,
        path: production.filePath,
        knowledge: deterministicEnvelope(context, [production.evidenceId], 'configuration'),
      },
      production.filePath,
    );
    if (node !== undefined && rule.produces.edgeType !== undefined) {
      builder.addEdge(
        {
          id: `custom:${rule.id}:${production.sourceNodeId}->${nodeId}`,
          type: rule.produces.edgeType,
          sourceId: production.sourceNodeId,
          targetId: nodeId,
          knowledge: deterministicEnvelope(context, [production.evidenceId], 'configuration'),
        },
        production.filePath,
      );
    }
  }
};

class CustomDetectionAdapter implements FrameworkAdapter {
  public readonly id = 'custom-detection';
  public readonly languageIds = ['typescript'];
  private readonly rules: readonly CustomDetectionRuleDto[];

  public constructor(rules: readonly CustomDetectionRuleDto[]) {
    this.rules = rules;
  }

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const matching = this.rules.filter(
      (rule) =>
        decoratorProductions(graph, rule).length > 0 || callProductions(graph, rule).length > 0,
    );
    return Promise.resolve({
      detected: matching.length > 0,
      evidenceIds: [],
      reason:
        matching.length > 0
          ? `custom detection rules matched: ${matching.map((rule) => rule.id).join(', ')}`
          : 'no custom detection rule matched',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const rule of this.rules) {
      emitRule(builder, graph, rule, context.indexing);
    }
    return Promise.resolve(builder.build());
  }
}

export const createCustomDetectionAdapter = (
  rules: readonly CustomDetectionRuleDto[],
): FrameworkAdapter => new CustomDetectionAdapter(rules);
