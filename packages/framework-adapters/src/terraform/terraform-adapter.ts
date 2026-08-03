import { FragmentBuilder, REFERENCE_RECEIVER } from '@impactgraph/language-adapters';

import { linkTerraformModules } from './terraform-modules.js';
import { linkTerraformReferences } from './terraform-references.js';
import { linkTerraformVariableValues } from './terraform-variable-values.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

// Story 16.1/16.3 — the Terraform/GCP framework adapter (PRD §15.2, §31).
//
// It exists for one structural reason: the indexer parses a file at a time so results stay
// cacheable (PRD §32), while Terraform's identity is per *directory* — `var.region` is declared in
// `variables.tf` and used in `main.tf`, and a `module` block names blocks in another directory
// entirely. Resolving those needs the assembled graph, which is precisely what a framework adapter
// gets. Nothing here re-parses a file (PRD §31); it reads the reference facts the language adapter
// recorded and turns the resolvable ones into edges.
//
// Provenance stays `configuration`, not `framework-convention`: resolving `google_pubsub_topic.
// deal_events` to the block that declares it is deterministic address lookup over parsed content,
// not a convention. Name-correspondence work across stacks is a different adapter (`cross-stack`)
// precisely so the two kinds of claim never share a provenance.

class TerraformFrameworkAdapter implements FrameworkAdapter {
  public readonly id = 'terraform';
  public readonly languageIds: readonly string[] = ['terraform'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const references = graph.callFacts.filter((fact) => fact.receiverName === REFERENCE_RECEIVER);
    const blocks = graph.nodes.filter((node) => String(node.id).startsWith('terraform:'));
    return Promise.resolve({
      detected: blocks.length > 0,
      evidenceIds: references.map((fact) => fact.evidenceId),
      reason:
        blocks.length > 0
          ? `Terraform configuration indexed (${String(blocks.length)} blocks)`
          : 'no Terraform blocks found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    linkTerraformReferences(builder, graph, context.indexing);
    linkTerraformModules(builder, graph, context.indexing);
    linkTerraformVariableValues(builder, graph, context.indexing);
    return Promise.resolve(builder.build());
  }
}

export const createTerraformFrameworkAdapter = (): FrameworkAdapter =>
  new TerraformFrameworkAdapter();
