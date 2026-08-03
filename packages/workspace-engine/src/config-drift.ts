import { matchesGlob } from '@impactgraph/application';
import { createGitCliAdapter } from '@impactgraph/git';
import { readAliasesConfig } from '@impactgraph/persistence';

import { isConfirmed, readConfirmations, subjectKindForDriftKind } from './config-confirmations.js';
import { failWith } from './failure.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { historicalCoChangeProposal } from './learning.js';
import { loadProjectKnowledge } from './rules.js';

import type { Failable } from './failure.js';
import type { ArchitectureModel, ArchitectureRule } from '@impactgraph/application';
import type { ConfigOperationDto } from '@impactgraph/contracts';
import type { KnowledgeGraph } from '@impactgraph/domain';

// Story 14.5 — §Z10 drift: after indexing, committed configuration is reconciled against the
// graph. Findings are MAINTENANCE ACTIONS, never silent edits: stale human knowledge is
// flagged for review and kept (§Z5); genuinely new structure gets a suggested operation that
// the ownership mode decides how to apply (§Z6).

export interface DriftItem {
  readonly kind:
    | 'stale-context'
    | 'stale-component'
    | 'dangling-alias'
    | 'dangling-rule-reference'
    | 'uncovered-package'
    | 'historical-co-change';
  readonly subject: string;
  readonly detail: string;
  /** Present when a structured operation would resolve the item (§Z7). */
  readonly suggestedOperation?: ConfigOperationDto | undefined;
}

export interface DriftReport {
  readonly needsReview: readonly DriftItem[];
  readonly suggestions: readonly DriftItem[];
}

const pathsOf = (graph: KnowledgeGraph): Set<string> => {
  const paths = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.path !== undefined) {
      paths.add(node.path);
    }
  }
  return paths;
};

const staleMappings = (model: ArchitectureModel, paths: ReadonlySet<string>): DriftItem[] => {
  const matchesSomething = (glob: string): boolean =>
    [...paths].some((path) => matchesGlob(path, glob));
  const items: DriftItem[] = [];
  for (const context of model.contexts) {
    for (const glob of context.paths) {
      if (!matchesSomething(glob)) {
        items.push({
          kind: 'stale-context',
          subject: context.name,
          detail: `context path '${glob}' matches no indexed files — kept for review, not deleted (§Z5)`,
        });
      }
    }
  }
  for (const component of model.components) {
    if (!matchesSomething(component.path)) {
      items.push({
        kind: 'stale-component',
        subject: component.path,
        detail: `component assignment matches no indexed files — kept for review, not deleted (§Z5)`,
      });
    }
  }
  return items;
};

const danglingAliases = (
  aliases: Readonly<Record<string, string>>,
  graph: KnowledgeGraph,
): DriftItem[] => {
  const names = new Set([...graph.nodes.values()].map((node) => node.name.toLowerCase()));
  return Object.entries(aliases)
    .filter(([, canonical]) => !names.has(canonical.toLowerCase()))
    .map(([alias, canonical]) => ({
      kind: 'dangling-alias' as const,
      subject: alias,
      detail: `alias target '${canonical}' matches no component in the current graph`,
      suggestedOperation: {
        kind: 'remove-alias' as const,
        alias,
        reason: `alias target '${canonical}' no longer exists in the repository`,
      },
    }));
};

const danglingRules = (
  rules: readonly ArchitectureRule[],
  model: ArchitectureModel,
): DriftItem[] => {
  const roles = new Set(model.components.map((component) => component.role));
  const contexts = new Set(model.contexts.map((context) => context.name));
  const items: DriftItem[] = [];
  for (const rule of rules) {
    if (rule.type !== 'dependency-direction') {
      continue;
    }
    const missing = [
      ...[rule.sourceRole, rule.forbiddenTargetRole].filter(
        (role) => role !== undefined && !roles.has(role),
      ),
      ...[rule.sourceContext, rule.forbiddenTargetContext].filter(
        (context) => context !== undefined && !contexts.has(context),
      ),
    ];
    if (missing.length > 0) {
      items.push({
        kind: 'dangling-rule-reference',
        subject: rule.id,
        detail: `rule references undefined role/context: ${missing.join(', ')}`,
      });
    }
  }
  return items;
};

/** Package nodes point at their manifest; the owning directory defines the context glob. */
const packageDir = (manifestPath: string): string =>
  manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/')) : '';

const uncoveredPackages = (graph: KnowledgeGraph, model: ArchitectureModel): DriftItem[] => {
  const items: DriftItem[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type !== 'package' || node.path === undefined) {
      continue;
    }
    const dir = packageDir(node.path);
    const glob = dir === '' ? '**' : `${dir}/**`;
    const probe = dir === '' ? 'any/file.ts' : `${dir}/any/file.ts`;
    const covered = model.contexts.some((context) =>
      context.paths.some((candidate) => matchesGlob(probe, candidate)),
    );
    if (!covered) {
      items.push({
        kind: 'uncovered-package',
        subject: node.name,
        detail: `package '${node.name}' (${dir === '' ? '.' : dir}) is not assigned to any context`,
        suggestedOperation: {
          kind: 'add-context',
          name: node.name,
          paths: [glob],
          reason: `newly detected package '${node.name}' has no context assignment`,
          confidence: 0.5,
        },
      });
    }
  }
  return items;
};

/**
 * §Z5: a human-confirmed value keeps its drift finding — it is still reported — but loses its
 * suggested operation, so generation/refresh can never auto-change what a human confirmed.
 */
const partitionByConfirmation = (rootDir: string, items: readonly DriftItem[]): DriftReport => {
  const confirmations = readConfirmations(rootDir);
  const humanConfirmed = (item: DriftItem): boolean => {
    const subjectKind = subjectKindForDriftKind(item.kind);
    return subjectKind !== undefined && isConfirmed(confirmations, subjectKind, item.subject);
  };
  const actionable = items.filter(
    (item) => item.suggestedOperation !== undefined && !humanConfirmed(item),
  );
  return {
    needsReview: [
      ...items.filter((item) => item.suggestedOperation === undefined),
      ...items
        .filter((item) => item.suggestedOperation !== undefined && humanConfirmed(item))
        .map((item) => ({
          kind: item.kind,
          subject: item.subject,
          detail: `${item.detail} — human-confirmed (§Z5): kept, never changed automatically`,
        })),
    ],
    suggestions: actionable,
  };
};

/** Reconcile committed configuration against the current graph (§Z10). Read-only. */
export const detectConfigDrift = async (rootDir: string): Promise<Failable<DriftReport>> => {
  const knowledge = loadProjectKnowledge(rootDir);
  if (!knowledge.ok) {
    return knowledge;
  }
  return withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return failWith(
        'configurationError',
        'no completed index generation — run `impactgraph index` first',
      );
    }
    const graph = current.value.graph;
    const aliasesResult = readAliasesConfig(rootDir);
    const aliases = aliasesResult.ok ? (aliasesResult.value?.aliases ?? {}) : {};
    const items = [
      ...staleMappings(knowledge.value.architecture, pathsOf(graph)),
      ...danglingAliases(aliases, graph),
      ...danglingRules(knowledge.value.rules, knowledge.value.architecture),
      ...uncoveredPackages(graph, knowledge.value.architecture),
      ...(await historyItems(rootDir, knowledge.value.rules)),
    ];
    return { ok: true, value: partitionByConfirmation(rootDir, items) };
  });
};

/** §C7: repository history as evidence — mined best-effort, silent when git is unavailable. */
const historyItems = async (
  rootDir: string,
  rules: readonly import('@impactgraph/application').ArchitectureRule[],
): Promise<DriftItem[]> => {
  const commits = await createGitCliAdapter().readRecentCommitFiles(rootDir, 200);
  if (!commits.ok) {
    return [];
  }
  const proposal = historicalCoChangeProposal(commits.value, rules);
  if (proposal === undefined) {
    return [];
  }
  return [
    {
      kind: 'historical-co-change',
      subject: 'schema-needs-migration',
      detail: proposal.reason,
      suggestedOperation: proposal,
    },
  ];
};
