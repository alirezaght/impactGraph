import type { TerraformBlock } from './terraform-blocks.js';

// Identity and typing. Two decisions are load-bearing here, and both come straight from how
// Terraform itself works rather than from anything this adapter invents.
//
// 1. **A directory is a module.** Terraform merges every `.tf` file in one directory into a single
//    module, and addresses (`google_pubsub_topic.deal_events`) are unique only inside it. Node ids
//    are therefore scoped by directory, not by file — `modules/dead-letter/google_pubsub_topic.x`
//    and `google_pubsub_topic.x` are different resources and must not collide.
// 2. **The address is the identity, the declared name is the label.** A node's id is its Terraform
//    address (what an engineer greps for); its `name` is the literal `name` attribute when the
//    configuration states one (`deal-events` — what the resource is called in GCP), because that
//    is the only string another stack could ever legitimately correspond to.

/** `modules/dead-letter/main.tf` → 'modules/dead-letter'; a root file → ''. */
export const directoryOf = (relativePath: string): string => {
  const slash = relativePath.lastIndexOf('/');
  return slash === -1 ? '' : relativePath.slice(0, slash);
};

const scopePrefix = (directory: string): string => (directory === '' ? '' : `${directory}/`);

/** Graph id of anything addressable in a Terraform directory. */
export const terraformNodeId = (directory: string, address: string): string =>
  `terraform:${scopePrefix(directory)}${address}`;

export const secretNodeId = (value: string): string => `terraform:secret:${value}`;

/**
 * How many labels a block kind carries, for the kinds this adapter turns into nodes.
 *
 * A `Map`, not an object literal: the key is a block keyword read straight out of an untrusted
 * file, and an object literal answers `__proto__` and `constructor` from its prototype (PRD §42.5)
 * — which let `resource "__proto__" "x" {}` past the `expected === undefined` guard below.
 */
const LABEL_COUNT = new Map<string, number>([
  ['resource', 2],
  ['data', 2],
  ['module', 1],
  ['variable', 1],
  ['output', 1],
  ['provider', 1],
]);

/**
 * Terraform's own address for a block, or undefined for a kind this adapter does not model.
 *
 * `terraform {}`, `locals {}`, `moved {}` and friends are configuration *settings*, not components
 * of the analyzed system, so they are deliberately not nodes. `var.` (not `variable.`) is used for
 * variables because that is the prefix references actually use, which makes reference resolution a
 * lookup rather than a translation.
 */
export const blockAddress = (block: TerraformBlock): string | undefined => {
  const expected = LABEL_COUNT.get(block.kind);
  if (expected === undefined || block.labels.length < expected) {
    return undefined;
  }
  const [first, second] = block.labels;
  if (first === undefined) {
    return undefined;
  }
  if (block.kind === 'resource') {
    return second === undefined ? undefined : `${first}.${second}`;
  }
  if (block.kind === 'data') {
    return second === undefined ? undefined : `data.${first}.${second}`;
  }
  return `${block.kind === 'variable' ? 'var' : block.kind}.${first}`;
};

/** Block kinds Terraform lets you repeat with `count`/`for_each`. Nothing else may carry them. */
const REPEATABLE_KINDS = new Set(['resource', 'data', 'module']);

/**
 * Upper bound on instance expansion. A literal `count = 500` is legal Terraform, and emitting 500
 * nodes would drown the graph the user came to read (PRD §33's 200-node default view). Past the
 * cap the block is indexed once and the real count is reported, which loses no information a
 * reader cannot recover from the warning.
 */
const MAX_EXPANDED_INSTANCES = 10;

/** What a block's `count`/`for_each` means for the graph, and what could not be resolved. */
export interface TerraformExpansion {
  /** Addresses to emit. Empty when the configuration declares no instance at all. */
  readonly addresses: readonly string[];
  /** Present whenever the multiplicity was not resolved exactly — reported, never guessed. */
  readonly warning?: string;
}

const indexedAddresses = (address: string, instances: number): readonly string[] =>
  Array.from({ length: instances }, (_unused, index) => `${address}[${String(index)}]`);

const countExpansion = (address: string, instances: number | undefined): TerraformExpansion => {
  if (instances === undefined) {
    return {
      addresses: [address],
      warning:
        `${address}: 'count' is an expression, so how many instances it declares is unresolved ` +
        '(Terraform is parsed, never evaluated) — indexed as one node for the whole set',
    };
  }
  if (instances === 0) {
    return {
      addresses: [],
      warning: `${address}: 'count = 0' — the configuration declares no instance of this block`,
    };
  }
  if (instances > MAX_EXPANDED_INSTANCES) {
    return {
      addresses: [address],
      warning:
        `${address}: 'count = ${String(instances)}' exceeds the ` +
        `${String(MAX_EXPANDED_INSTANCES)}-instance expansion cap — indexed as one node`,
    };
  }
  return { addresses: indexedAddresses(address, instances) };
};

/**
 * The addresses one block contributes (PRD §35 — parsed, never evaluated).
 *
 * `count = 3` genuinely creates three objects and Terraform addresses them `<address>[0..2]`, so
 * three nodes is the truthful model and one node would be a quiet lie. `count = var.enabled ? 1 :
 * 0` and every `for_each` are unknowable without running Terraform, so they yield exactly one node
 * and a warning saying the multiplicity is unresolved — never an evaluated guess.
 */
export const expandBlockAddress = (block: TerraformBlock, address: string): TerraformExpansion => {
  if (!REPEATABLE_KINDS.has(block.kind)) {
    return { addresses: [address] };
  }
  const count = block.attributes.get('count');
  if (count !== undefined) {
    return countExpansion(address, count.integer);
  }
  return block.attributes.has('for_each')
    ? {
        addresses: [address],
        warning:
          `${address}: 'for_each' keys are not evaluated, so how many instances it declares is ` +
          'unresolved — indexed as one node for the whole set',
      }
    : { addresses: [address] };
};

/**
 * GCP resource types PRD §15.2 names explicitly. This is a direct read of the type string the
 * configuration declares — `resource "google_pubsub_topic"` IS a Pub/Sub topic — so it is a
 * `configuration` fact, not an inference.
 */
const RESOURCE_NODE_TYPES = new Map<string, string>([
  ['google_cloud_run_service', 'cloud-run-service'],
  ['google_cloud_run_v2_service', 'cloud-run-service'],
  ['google_cloud_run_job', 'cloud-run-job'],
  ['google_cloud_run_v2_job', 'cloud-run-job'],
  ['google_pubsub_topic', 'pubsub-topic'],
  ['google_pubsub_subscription', 'pubsub-subscription'],
  ['google_service_account', 'service-account'],
  ['google_secret_manager_secret', 'secret'],
]);

const IAM_RESOURCE = /_iam_(member|binding|policy|custom_role)$/;

/** A `Map` for the §42.5 reason above: `resource "__proto__"` must MISS, not find a prototype. */
export const resourceNodeType = (resourceType: string): string =>
  RESOURCE_NODE_TYPES.get(resourceType) ??
  (IAM_RESOURCE.test(resourceType) ? 'iam-role' : 'terraform-resource');

/**
 * Node type for a block. `variable` and `output` carry the ADR-0017 vocabulary types the runtime
 * layer distinguishes: a variable is a RESOLUTION hop a value passes through, never a process that
 * serves traffic — typing it `terraform-resource` once made a runtime walk report an input
 * variable as the process serving production traffic. `provider` and `data` stay
 * `terraform-resource`: PRD §12.1 has no more specific type for them, and the id and name carry
 * the exact block kind, so nothing is lost.
 */
export const blockNodeType = (block: TerraformBlock): string => {
  if (block.kind === 'module') {
    return 'terraform-module';
  }
  if (block.kind === 'variable') {
    return 'terraform-variable';
  }
  if (block.kind === 'output') {
    return 'terraform-output';
  }
  const resourceType = block.labels[0];
  if (block.kind === 'resource' && resourceType !== undefined) {
    return resourceNodeType(resourceType);
  }
  return 'terraform-resource';
};

/**
 * A resource's declared name when the configuration states one literally; otherwise its address.
 * A `name` that interpolates (`"${var.topic_name}-dead-letter"`) has no literal value without
 * running Terraform, so the address is used and the caller records a warning.
 */
export const blockDisplayName = (block: TerraformBlock, address: string): string => {
  if (block.kind !== 'resource') {
    return address;
  }
  const declared = block.attributes.get('name');
  return declared?.literal !== undefined && declared.literal !== '' ? declared.literal : address;
};
