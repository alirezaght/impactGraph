import {
  EDGE_TYPES,
  isNodeCategory,
  isNodeTypeInCategory,
  isProvenance,
  knowledgeCategoryOf,
} from '@impactgraph/domain';

import type {
  ContractEdge,
  ContractFragment,
  ContractLanguageAdapter,
  ContractNode,
  LanguageAdapterContractOptions,
} from './adapter-contract-types.js';

// The individual §30/§31 invariants. Each returns a list of failure strings — empty means the
// invariant held. No test framework is involved so that test-kit stays dependency-free.

export const detectionFailures = (
  detected: boolean,
  reason: string | undefined,
  fixtureName: string,
): string[] => {
  const failures: string[] = [];
  if (!detected) {
    failures.push(`detectProject did not detect the matching fixture '${fixtureName}'`);
  }
  if (reason === undefined || reason.trim().length === 0) {
    failures.push('DetectionResult carried no reason — detection must be explainable (§30)');
  }
  return failures;
};

export const vocabularyFailures = (fragment: ContractFragment): string[] => {
  const failures: string[] = [];
  for (const node of fragment.nodes) {
    if (!isNodeCategory(node.category)) {
      failures.push(`node '${node.id}': category '${node.category}' is not in PRD §12.1`);
    } else if (!isNodeTypeInCategory(node.category, node.type)) {
      failures.push(`node '${node.id}': type '${node.type}' is not in category '${node.category}'`);
    }
  }
  for (const edge of fragment.edges) {
    if (!(EDGE_TYPES as readonly string[]).includes(edge.type)) {
      failures.push(`edge '${edge.id}': type '${edge.type}' is not in PRD §12.2`);
    }
  }
  return failures;
};

const factFailures = (
  fact: ContractNode | ContractEdge,
  evidenceIds: ReadonlySet<string>,
  snapshotId: string,
): string[] => {
  const failures: string[] = [];
  const { provenance, evidenceIds: ids, repositorySnapshotId } = fact.knowledge;
  if (!isProvenance(provenance) || knowledgeCategoryOf(provenance) !== 'deterministic') {
    failures.push(`'${fact.id}': provenance '${provenance}' is not a deterministic category`);
  }
  if (ids.length === 0) {
    failures.push(`'${fact.id}': no evidence id — every fact needs evidence (§12.3)`);
  }
  for (const id of ids) {
    if (!evidenceIds.has(id)) {
      failures.push(`'${fact.id}': evidence '${id}' is not present in the fragment`);
    }
  }
  if (repositorySnapshotId !== snapshotId) {
    failures.push(`'${fact.id}': snapshot '${repositorySnapshotId}' ≠ context '${snapshotId}'`);
  }
  return failures;
};

export const provenanceFailures = (fragment: ContractFragment, snapshotId: string): string[] => {
  const evidenceIds = new Set(fragment.evidence.map((record) => record.id));
  return [...fragment.nodes, ...fragment.edges].flatMap((fact) =>
    factFailures(fact, evidenceIds, snapshotId),
  );
};

export const determinismFailures = (first: ContractFragment, second: ContractFragment): string[] =>
  JSON.stringify(first) === JSON.stringify(second)
    ? []
    : ['indexing the same files twice produced different output — indexing must be deterministic'];

/** Hostile content may produce wrong facts; it may never abort the run (PRD §42.5, §34). */
export const hostileFailures = (
  fragment: ContractFragment,
  controlPath: string,
  hostilePaths: readonly string[],
): string[] => {
  const failures: string[] = [];
  if (!fragment.nodes.some((node) => node.id === `file:${controlPath}`)) {
    failures.push(`hostile input suppressed the control file '${controlPath}' — the run aborted`);
  }
  for (const path of hostilePaths) {
    const indexed = fragment.nodes.some((node) => node.id === `file:${path}`);
    const warned = fragment.warnings.some((warning) => warning.filePath === path);
    if (!indexed && !warned) {
      failures.push(`hostile file '${path}' produced neither a fact nor a warning (§34)`);
    }
  }
  return failures;
};

export const unparseableFailures = (fragment: ContractFragment, path: string): string[] => {
  const failures: string[] = [];
  if (!fragment.warnings.some((warning) => warning.filePath === path)) {
    failures.push(`unparseable file '${path}' produced no warning — failures must be reported`);
  }
  if (fragment.nodes.length === 0) {
    failures.push('an unparseable file aborted the whole run instead of costing one file');
  }
  return failures;
};

const FILE_LEVEL_TYPES: readonly string[] = ['file', 'test'];

/** Claimed extensions must be well-formed, and unclaimed files get file-level facts at most. */
export const foreignFileFailures = (
  adapter: ContractLanguageAdapter,
  fragment: ContractFragment,
  options: LanguageAdapterContractOptions,
): string[] => {
  const failures: string[] = [];
  for (const extension of adapter.supportedExtensions) {
    if (!extension.startsWith('.') || extension !== extension.toLowerCase()) {
      failures.push(`supportedExtensions entry '${extension}' is not a lowercase dotted extension`);
    }
  }
  for (const file of options.foreignFiles) {
    const claimed = adapter.supportedExtensions.some((extension) =>
      file.relativePath.toLowerCase().endsWith(extension),
    );
    if (claimed) {
      failures.push(`fixture error: '${file.relativePath}' IS inside supportedExtensions`);
    }
  }
  for (const node of fragment.nodes) {
    if (!FILE_LEVEL_TYPES.includes(node.type)) {
      failures.push(
        `node '${node.id}' (${node.type}) was emitted for a file outside supportedExtensions`,
      );
    }
  }
  return failures;
};
