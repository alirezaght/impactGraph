import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractConfigDeclarations } from '@impactgraph/application';

import { searchLiterals } from './literal-search.js';

import type { ConfigDeclaration } from '@impactgraph/application';
import type {
  ConfigRequirement,
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
} from '@impactgraph/domain';

/**
 * What configuration the PLAN needs, and how the repository declares it — the two inputs the
 * runtime and config-semantics analyzers were designed around and never received in the analysis
 * path (they were wired as empty lists, so both checks were unreachable outside unit tests).
 *
 * Requirement derivation is deliberately narrow: only configuration nodes the impact model matched
 * at hop zero count as "the plan needs this". Everything the graph merely contains stays out, so
 * one analysis cannot demand every environment variable in the repository (signal over volume).
 */

const CONFIG_NODE_TYPES = new Set(['environment-variable', 'config-key']);

export interface ConfigPreflightInputs {
  readonly requirements: readonly ConfigRequirement[];
  readonly declarations: readonly ConfigDeclaration[];
}

const hopZeroConfigNodes = (
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): ReadonlyMap<string, { readonly nodeId: string; readonly evidenceIds: readonly string[] }> => {
  const byName = new Map<string, { nodeId: string; evidenceIds: readonly string[] }>();
  for (const impact of analysis.requirementImpacts) {
    if (impact.dependencyPath.length > 1) {
      continue;
    }
    const node = graph.nodes.get(impact.nodeId as NodeId);
    if (node !== undefined && CONFIG_NODE_TYPES.has(node.type) && !byName.has(node.name)) {
      byName.set(node.name, { nodeId: node.id, evidenceIds: node.knowledge.evidenceIds });
    }
  }
  return byName;
};

/** Reading a declaring file must never break analysis: unreadable means undeclared here. */
const readSource = (rootDir: string, path: string): string | undefined => {
  try {
    const content = readFileSync(join(rootDir, path), 'utf8');
    return content.length > 0 && content.length < 400_000 ? content : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Files worth reading for one name: every graph node carrying the name (the Terraform env entry,
 * the client that reads it) plus the files whose CALL ARGUMENTS mention it in the fragment cache
 * (`os.environ.get("NAME", …)` lives there). Bounded per name; no repository walk.
 */
const candidatePaths = async (
  rootDir: string,
  graph: KnowledgeGraph,
  name: string,
): Promise<readonly string[]> => {
  const paths = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.name === name && node.path !== undefined) {
      paths.add(node.path);
    }
  }
  const literals = await searchLiterals(rootDir, { pattern: name, limit: 10 });
  if (literals.ok) {
    for (const match of literals.value.matches) {
      paths.add(match.filePath);
    }
  }
  return [...paths].sort().slice(0, 10);
};

export const configPreflightInputs = async (
  rootDir: string,
  graph: KnowledgeGraph,
  analysis: ImpactAnalysis,
): Promise<ConfigPreflightInputs> => {
  const named = hopZeroConfigNodes(analysis, graph);
  const requirements: ConfigRequirement[] = [];
  const declarations: ConfigDeclaration[] = [];
  for (const [name, node] of named) {
    requirements.push({ name, requiredByNodeId: node.nodeId, evidenceIds: node.evidenceIds });
    for (const path of await candidatePaths(rootDir, graph, name)) {
      const content = readSource(rootDir, path);
      if (content === undefined) {
        continue;
      }
      declarations.push(
        ...extractConfigDeclarations({
          name,
          filePath: path,
          content,
          evidenceIds: node.evidenceIds,
        }),
      );
    }
  }
  return { requirements, declarations };
};
