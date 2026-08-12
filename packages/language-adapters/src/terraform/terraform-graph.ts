import { fileNodeId } from '../file-node.js';
import { deterministicEnvelope } from '../fragment-builder.js';

import {
  blockAddress,
  blockDisplayName,
  blockNodeType,
  expandBlockAddress,
  secretNodeId,
  terraformNodeId,
} from './terraform-addresses.js';

import type {
  TerraformAssignment,
  TerraformBlock,
  TerraformDocument,
  TerraformSecretRef,
} from './terraform-blocks.js';
import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { KnowledgeEnvelopeInput, SourceRange } from '@impactgraph/domain';

// One file's worth of Terraform facts.
//
// Provenance is `configuration` throughout, never `static-analysis`. A `.tf` file is a declarative
// description of infrastructure that some other tool will apply; reading it tells us what the
// configuration *says*, which is a different kind of knowledge from what parsed code *does*. That
// distinction is exactly what the provenance field exists to preserve (PRD §12.3).
//
// Everything emitted here is **file-local**, because the indexer parses one file at a time so each
// result is individually cacheable by content hash (PRD §32, `index-repository.ts`). A Terraform
// reference crosses files routinely (`var.region` lives in `variables.tf`), so those relationships
// travel out on the `CallFact` channel — the language-neutral "raw material for framework
// adapters" bus — and are resolved against the assembled graph by the `terraform` framework
// adapter, exactly as FastAPI resolves `include_router` (PRD §31).

export interface TerraformEmitState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
  readonly directory: string;
}

/** Marks a reference fact on the CallFact channel: `calleeName` is the referenced address. */
export const REFERENCE_RECEIVER = 'terraform:reference';

/** Marks a module-source fact: `calleeName` is the literal `source` value. */
export const MODULE_SOURCE_RECEIVER = 'terraform:module-source';

/** Marks a `.tfvars` assignment: `calleeName` is the `var.<name>` address it sets. */
export const VARIABLE_VALUE_RECEIVER = 'terraform:variable-value';

/**
 * Marks a container `env` binding: `calleeName` is the referenced address, `stringArguments[0]` the
 * environment variable name. Both halves are written in the source, so this is a parsed
 * `configuration` fact; what it MEANS for the application reading that variable is a platform
 * convention, and belongs to `cross-stack/cloud-run-env.ts` rather than here.
 */
export const CLOUD_RUN_ENV_RECEIVER = 'terraform:cloud-run-env';

interface EvidenceInput {
  readonly range: SourceRange;
  readonly symbolName: string;
}

const evidenceAt = (
  state: TerraformEmitState,
  kind: 'terraform-resource' | 'config-entry',
  input: EvidenceInput,
): string | undefined => {
  const position = `${String(input.range.startLine)}:${String(input.range.startColumn)}`;
  // The symbol belongs in the id: `count` expansion declares `shard[0]` and `shard[1]` at ONE
  // position, and two records under one id means deduplication silently drops an instance.
  return state.builder.addEvidence(
    {
      id: `ev:${kind}:${state.filePath}:${position}:${input.symbolName}`,
      kind,
      source: {
        kind: 'file',
        filePath: state.filePath,
        range: input.range,
        symbolName: input.symbolName,
      },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

const configurationKnowledge = (
  state: TerraformEmitState,
  evidenceId: string,
): KnowledgeEnvelopeInput => deterministicEnvelope(state.context, [evidenceId], 'configuration');

/** Capped like the parser's own error reporting: one bad file cannot flood the warning channel. */
const MAX_UNRESOLVED_REPORTED = 3;

/**
 * Report every attribute whose value interpolates. This is the honest half of "never evaluate":
 * the adapter does not guess `"gcr.io/${var.project_id}/deals-api:latest"`, and it does not stay
 * quiet about having skipped it either (PRD §34, §35).
 */
const warnUnresolvedAttributes = (
  state: TerraformEmitState,
  block: TerraformBlock,
  address: string,
): void => {
  for (const entry of block.unresolved.slice(0, MAX_UNRESOLVED_REPORTED)) {
    state.builder.warn(
      state.filePath,
      `${address}: attribute '${entry.name}' at line ${String(entry.range.startLine)} ` +
        'interpolates — its value is not resolved (Terraform is parsed, never evaluated)',
    );
  }
};

/**
 * Secret bindings (PRD §15.2). A literal `secret_id`/`secret` attribute names a Secret Manager
 * secret the block binds to — an IAM member granting access to `db-password`, a Cloud Run
 * container mounting one. The secret resource *itself* is skipped: it is already a `secret` node,
 * and pointing it at a duplicate of itself would say nothing.
 */
const bindSecret = (
  state: TerraformEmitState,
  sourceNodeId: string,
  secret: TerraformSecretRef,
): void => {
  const nodeId = secretNodeId(secret.value);
  const evidenceId = evidenceAt(state, 'config-entry', {
    range: secret.range,
    symbolName: secret.value,
  });
  if (evidenceId === undefined) {
    return;
  }
  const knowledge = configurationKnowledge(state, evidenceId);
  state.builder.addNode(
    {
      id: nodeId,
      category: 'infrastructure',
      type: 'secret',
      name: secret.value,
      path: state.filePath,
      knowledge,
    },
    state.filePath,
  );
  state.builder.addEdge(
    {
      id: `terraform:uses-secret:${sourceNodeId}->${nodeId}`,
      // §12.2.1: referencing resource → referenced infrastructure resource.
      type: 'REFERENCES_RESOURCE',
      sourceId: sourceNodeId,
      targetId: nodeId,
      knowledge,
    },
    state.filePath,
  );
};

/** Cross-file relationships leave as facts, not edges — see the module comment. */
const recordCrossFileFacts = (
  state: TerraformEmitState,
  block: TerraformBlock,
  nodeId: string,
): void => {
  for (const reference of block.references) {
    const evidenceId = evidenceAt(state, 'config-entry', {
      range: reference.range,
      symbolName: reference.address,
    });
    if (evidenceId !== undefined) {
      state.builder.addCallFact({
        filePath: state.filePath,
        receiverName: REFERENCE_RECEIVER,
        calleeName: reference.address,
        stringArguments: [],
        identifierArguments: [],
        enclosingSymbolNodeId: nodeId,
        evidenceId,
      });
    }
  }
  recordModuleSource(state, block, nodeId);
  recordEnvBindings(state, block, nodeId);
};

/** `env { name = "X" value = <resource reference> }` — recorded verbatim, resolved by nobody here. */
const recordEnvBindings = (
  state: TerraformEmitState,
  block: TerraformBlock,
  nodeId: string,
): void => {
  for (const binding of block.envBindings) {
    const evidenceId = evidenceAt(state, 'config-entry', {
      range: binding.range,
      symbolName: binding.envName,
    });
    if (evidenceId !== undefined) {
      state.builder.addCallFact({
        filePath: state.filePath,
        receiverName: CLOUD_RUN_ENV_RECEIVER,
        calleeName: binding.address,
        stringArguments: [binding.envName],
        identifierArguments: [],
        enclosingSymbolNodeId: nodeId,
        evidenceId,
      });
    }
  }
};

const recordModuleSource = (
  state: TerraformEmitState,
  block: TerraformBlock,
  nodeId: string,
): void => {
  const source = block.kind === 'module' ? block.attributes.get('source') : undefined;
  if (source?.literal === undefined) {
    return;
  }
  const evidenceId = evidenceAt(state, 'config-entry', {
    range: source.range,
    symbolName: source.literal,
  });
  if (evidenceId !== undefined) {
    state.builder.addCallFact({
      filePath: state.filePath,
      receiverName: MODULE_SOURCE_RECEIVER,
      calleeName: source.literal,
      stringArguments: [],
      identifierArguments: [],
      enclosingSymbolNodeId: nodeId,
      evidenceId,
    });
  }
};

/** Emit one block: its node, its file CONTAINS edge, its secret bindings and its raw references. */
const emitBlock = (state: TerraformEmitState, block: TerraformBlock, address: string): void => {
  const nodeId = terraformNodeId(state.directory, address);
  const evidenceId = evidenceAt(state, 'terraform-resource', {
    range: block.range,
    symbolName: address,
  });
  if (evidenceId === undefined) {
    return;
  }
  const knowledge = configurationKnowledge(state, evidenceId);
  const nodeType = blockNodeType(block);
  const node = state.builder.addNode(
    {
      id: nodeId,
      category: 'infrastructure',
      type: nodeType,
      name: blockDisplayName(block, address),
      path: state.filePath,
      knowledge,
    },
    state.filePath,
  );
  if (node === undefined) {
    return;
  }
  state.builder.addEdge(
    {
      id: `terraform:contains:${state.filePath}->${nodeId}`,
      type: 'CONTAINS',
      sourceId: fileNodeId(state.filePath),
      targetId: nodeId,
      knowledge,
    },
    state.filePath,
  );
  warnUnresolvedAttributes(state, block, address);
  for (const secret of nodeType === 'secret' ? [] : block.secrets) {
    bindSecret(state, nodeId, secret);
  }
  recordCrossFileFacts(state, block, nodeId);
};

/**
 * Emit every instance one block declares. `count = 3` is three objects in Terraform's own model
 * and therefore three nodes here; anything the adapter cannot resolve without evaluating is one
 * node plus the warning `expandBlockAddress` produced (PRD §34, §35).
 */
const emitBlockInstances = (
  state: TerraformEmitState,
  block: TerraformBlock,
  address: string,
): void => {
  const expansion = expandBlockAddress(block, address);
  if (expansion.warning !== undefined) {
    state.builder.warn(state.filePath, expansion.warning);
  }
  for (const instance of expansion.addresses) {
    emitBlock(state, block, instance);
  }
};

/**
 * `project_id = "impact-graph"` in a `.tfvars` file supplies a value for the `variable` block of
 * that name. Which block that is depends on the directory, which this adapter cannot see (it
 * parses one file at a time), so the assignment leaves as a fact on the `CallFact` channel and
 * becomes a CONFIGURES edge in the `terraform` framework adapter. The assigned VALUE is
 * deliberately not read: a `.tfvars` entry is frequently a secret, and nothing downstream needs it
 * to know which variable is configured.
 */
const emitAssignment = (state: TerraformEmitState, assignment: TerraformAssignment): void => {
  const address = `var.${assignment.name}`;
  const evidenceId = evidenceAt(state, 'config-entry', {
    range: assignment.range,
    symbolName: address,
  });
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName: VARIABLE_VALUE_RECEIVER,
    calleeName: address,
    stringArguments: [],
    identifierArguments: [],
    enclosingSymbolNodeId: fileNodeId(state.filePath),
    evidenceId,
  });
};

/**
 * One node per `locals` ENTRY (ADR-0017).
 *
 * A `locals` block was previously skipped as a configuration setting rather than a component of the
 * system. That reading cost real money: `admin → NEWSLETTER_SERVICE_URL →
 * frontend_service_urls.newsletter → _agg.newsletter → aggregator` runs through two locals, and
 * with neither in the graph the chain could not be walked, so nothing could notice the aggregator
 * was serving traffic the plan never configured.
 *
 * The entry, not the block, is the node: a `locals` block holds independent values, and merging
 * them would make every local look like it referenced whatever any local referenced.
 */
const emitLocals = (state: TerraformEmitState, block: TerraformBlock): void => {
  for (const [name, attribute] of block.attributes) {
    const address = `local.${name}`;
    const evidenceId = evidenceAt(state, 'terraform-resource', {
      range: attribute.range,
      symbolName: address,
    });
    if (evidenceId === undefined) {
      continue;
    }
    const nodeId = terraformNodeId(state.directory, address);
    const knowledge = configurationKnowledge(state, evidenceId);
    const node = state.builder.addNode(
      {
        id: nodeId,
        category: 'infrastructure',
        type: 'terraform-local',
        name: address,
        path: state.filePath,
        knowledge,
      },
      state.filePath,
    );
    if (node === undefined) {
      continue;
    }
    state.builder.addEdge(
      {
        id: `terraform:contains:${state.filePath}->${nodeId}`,
        type: 'CONTAINS',
        sourceId: fileNodeId(state.filePath),
        targetId: nodeId,
        knowledge,
      },
      state.filePath,
    );
    for (const reference of attribute.references) {
      state.builder.addCallFact({
        filePath: state.filePath,
        receiverName: REFERENCE_RECEIVER,
        calleeName: reference.address,
        stringArguments: [],
        identifierArguments: [],
        enclosingSymbolNodeId: nodeId,
        evidenceId,
      });
    }
  }
};

/**
 * Emit one file's contents. A duplicate address within a file (invalid Terraform, which the CLI
 * would reject) is indexed once: reporting the same resource twice would be a worse lie than
 * reporting it once.
 */
export const emitTerraformFile = (state: TerraformEmitState, document: TerraformDocument): void => {
  const seen = new Set<string>();
  for (const block of document.blocks) {
    if (block.kind === 'locals') {
      emitLocals(state, block);
      continue;
    }
    const address = blockAddress(block);
    if (address === undefined || seen.has(address)) {
      continue;
    }
    seen.add(address);
    emitBlockInstances(state, block, address);
  }
  for (const assignment of document.assignments) {
    emitAssignment(state, assignment);
  }
};
