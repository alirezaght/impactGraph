import {
  deterministicEnvelope,
  directoryOf,
  MODULE_SOURCE_RECEIVER,
  resolveLocalModuleDirectory,
} from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// `module "x" { source = "./modules/x" }` → CONTAINS edges to everything that directory declares.
// A Terraform directory IS a module, so the module call's contents are exactly the blocks indexed
// under the resolved path — a path calculation over the scanned file set, never a guess.

const TERRAFORM_NODE_PREFIX = 'terraform:';

/** Terraform block nodes grouped by the directory (= module) that declares them. */
const blocksByDirectory = (graph: CodeGraph): ReadonlyMap<string, GraphNode[]> => {
  const byDirectory = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const path = node.path;
    if (path === undefined || !String(node.id).startsWith(TERRAFORM_NODE_PREFIX)) {
      continue;
    }
    const directory = directoryOf(path);
    const list = byDirectory.get(directory) ?? [];
    list.push(node);
    byDirectory.set(directory, list);
  }
  return byDirectory;
};

interface ModuleLink {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly fact: CallFact;
  readonly byDirectory: ReadonlyMap<string, GraphNode[]>;
}

const linkModule = (input: ModuleLink): void => {
  const { builder, context, fact, byDirectory } = input;
  const sourceId = fact.enclosingSymbolNodeId;
  const directory = resolveLocalModuleDirectory(directoryOf(fact.filePath), fact.calleeName);
  if (sourceId === undefined || directory === undefined) {
    builder.warn(
      fact.filePath,
      `module source '${fact.calleeName}' is not a local path — its contents are outside the ` +
        'indexed repository',
    );
    return;
  }
  const members = (byDirectory.get(directory) ?? []).filter((node) => String(node.id) !== sourceId);
  if (members.length === 0) {
    builder.warn(
      fact.filePath,
      `module source '${fact.calleeName}' resolved to '${directory}', which declares no ` +
        'indexed Terraform blocks',
    );
    return;
  }
  const knowledge = deterministicEnvelope(context, [fact.evidenceId], 'configuration');
  for (const member of members) {
    builder.addEdge(
      {
        id: `terraform:module-contains:${sourceId}->${String(member.id)}`,
        type: 'CONTAINS',
        sourceId,
        targetId: String(member.id),
        knowledge,
      },
      fact.filePath,
    );
  }
};

export const linkTerraformModules = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const byDirectory = blocksByDirectory(graph);
  for (const fact of graph.callFacts) {
    if (fact.receiverName === MODULE_SOURCE_RECEIVER) {
      linkModule({ builder, context, fact, byDirectory });
    }
  }
};
