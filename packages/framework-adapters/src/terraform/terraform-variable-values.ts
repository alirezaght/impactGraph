import {
  deterministicEnvelope,
  directoryOf,
  terraformNodeId,
  VARIABLE_VALUE_RECEIVER,
} from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// `.tfvars` → CONFIGURES (Story 16.1, PRD §12.2, §15.2).
//
// A `.tfvars` file supplies values for `variable` blocks: `project_id = "impact-graph"` configures
// `variable "project_id"`. Which block that is depends on the directory, because a Terraform
// directory IS a module and a variable's address is unique only inside one — so the language
// adapter records the assignment as a fact and the resolution happens here, against the assembled
// graph, exactly like a `var.` reference.
//
// Scope, stated plainly: the file is bound to the variables declared in ITS OWN directory. Terraform
// itself allows `-var-file=../shared/prod.tfvars` from anywhere, and which module a stray `.tfvars`
// feeds is decided on a command line this adapter never sees (PRD §35). A same-directory file is
// the only case the repository states rather than implies; anything else is reported, not guessed.

const configuresEdge = (
  builder: FragmentBuilder,
  context: IndexingContext,
  fact: CallFact,
  target: GraphNode,
): void => {
  const sourceId = fact.enclosingSymbolNodeId;
  if (sourceId === undefined) {
    return;
  }
  builder.addEdge(
    {
      id: `terraform:configures:${sourceId}->${String(target.id)}`,
      type: 'CONFIGURES',
      sourceId,
      targetId: String(target.id),
      knowledge: deterministicEnvelope(context, [fact.evidenceId], 'configuration'),
    },
    fact.filePath,
  );
};

/**
 * Every `.tfvars` assignment becomes a CONFIGURES edge from the values file to the variable it
 * sets, or a warning naming the variable no block in that directory declares. An assignment for an
 * undeclared variable is a real configuration defect, so reporting it is the useful behaviour.
 */
export const linkTerraformVariableValues = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const nodes = new Map(graph.nodes.map((node) => [String(node.id), node]));
  for (const fact of graph.callFacts) {
    if (fact.receiverName !== VARIABLE_VALUE_RECEIVER) {
      continue;
    }
    const target = nodes.get(terraformNodeId(directoryOf(fact.filePath), fact.calleeName));
    if (target === undefined) {
      builder.warn(
        fact.filePath,
        `'${fact.calleeName.replace('var.', '')}' is assigned a value here, but no variable of ` +
          'that name is declared in this Terraform module',
      );
      continue;
    }
    configuresEdge(builder, context, fact, target);
  }
};
