import { matchesGlob } from '@impactgraph/application';

import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { Documents } from './config-changes.js';
import type { ConfigFileName } from './config-validation.js';
import type { ConfigSubjectKindDto } from '@impactgraph/contracts';
import type { KnowledgeGraph } from '@impactgraph/domain';

// Locating a configuration value and projecting what it currently touches in the graph — the
// deterministic half of `explain_configuration`. No AI, no heuristics: a value is found in a
// committed document or it is not, and "affects" is counted against the indexed graph.

export interface SubjectLocation {
  readonly subjectKind: ConfigSubjectKindDto;
  readonly file: ConfigFileName;
  readonly description: string;
  readonly definition: Record<string, unknown>;
}

type Finder = (documents: Documents, subject: string) => SubjectLocation | undefined;

const contextFinder: Finder = (documents, subject) => {
  const context = (documents.architecture.contexts ?? []).find((entry) => entry.name === subject);
  if (context === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'context',
    file: 'architecture.yml',
    description: `bounded context owning ${String(context.paths.length)} path glob(s); scopes impact grouping and dependency-direction rules`,
    definition: { ...context },
  };
};

const componentFinder: Finder = (documents, subject) => {
  const component = (documents.architecture.components ?? []).find(
    (entry) => entry.path === subject,
  );
  if (component === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'component',
    file: 'architecture.yml',
    description: 'human-confirmed component assignment: gives matching files their role/context',
    definition: { ...component },
  };
};

const aliasFinder: Finder = (documents, subject) => {
  const canonical = (documents.aliases.aliases ?? {})[subject];
  if (canonical === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'alias',
    file: 'aliases.yml',
    description: `maps the specification concept '${subject}' to component '${canonical}' — alias matches carry the human-confirmed-mapping confidence signal (§14)`,
    definition: { alias: subject, canonical },
  };
};

const exclusionFinder: Finder = (documents, subject) => {
  const exclusion = (documents.aliases.exclusions ?? []).find(
    (entry) => entry.component.toLowerCase() === subject.toLowerCase(),
  );
  if (exclusion === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'exclusion',
    file: 'aliases.yml',
    description: '§Z9 learned exclusion: this component is never suggested as an impact',
    definition: { ...exclusion },
  };
};

const ruleFinder: Finder = (documents, subject) => {
  const rule = (documents.rules.rules ?? []).find((entry) => entry.id === subject);
  if (rule === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'rule',
    file: 'rules.yml',
    description: `§27 ${rule.type} rule — evaluated deterministically against each review delta`,
    definition: { ...rule },
  };
};

const detectionFinder: Finder = (documents, subject) => {
  const detection = (documents.rules.detections ?? []).find((entry) => entry.id === subject);
  if (detection === undefined) {
    return undefined;
  }
  return {
    subjectKind: 'detection',
    file: 'rules.yml',
    description: `§Z8 custom detection rule producing ${detection.produces.nodeCategory}/${detection.produces.nodeType} nodes with configuration provenance`,
    definition: { ...detection },
  };
};

const ignoreFinder: Finder = (documents, subject) => {
  if (!(documents.workspace.ignore ?? []).includes(subject)) {
    return undefined;
  }
  return {
    subjectKind: 'ignore',
    file: 'config.yml',
    description: 'ignore glob: matching files are excluded from indexing (§40.1)',
    definition: { glob: subject },
  };
};

const FINDERS: Readonly<Record<ConfigSubjectKindDto, Finder>> = {
  context: contextFinder,
  component: componentFinder,
  alias: aliasFinder,
  exclusion: exclusionFinder,
  rule: ruleFinder,
  detection: detectionFinder,
  ignore: ignoreFinder,
};

const LOOKUP_ORDER: readonly ConfigSubjectKindDto[] = [
  'context',
  'component',
  'alias',
  'exclusion',
  'rule',
  'detection',
  'ignore',
];

export const locateSubject = (
  documents: Documents,
  subject: string,
  hint?: ConfigSubjectKindDto,
): SubjectLocation | undefined => {
  if (hint !== undefined) {
    return FINDERS[hint](documents, subject);
  }
  for (const kind of LOOKUP_ORDER) {
    const located = FINDERS[kind](documents, subject);
    if (located !== undefined) {
      return located;
    }
  }
  return undefined;
};

export interface SubjectImpact {
  readonly nodeCount: number;
  readonly sampleNodeIds: readonly string[];
  readonly detail: string;
}

const SAMPLE_LIMIT = 5;

const matchingNodeIds = (
  graph: KnowledgeGraph,
  predicate: (node: { id: string; name: string; path?: string | undefined }) => boolean,
): string[] => {
  const ids: string[] = [];
  for (const node of graph.nodes.values()) {
    if (predicate(node)) {
      ids.push(node.id);
    }
  }
  return ids;
};

const globs = (location: SubjectLocation): readonly string[] => {
  const definition = location.definition;
  if (Array.isArray(definition['paths'])) {
    return definition['paths'] as readonly string[];
  }
  const single = definition['path'] ?? definition['glob'];
  return typeof single === 'string' ? [single] : [];
};

const nameOf = (location: SubjectLocation, subject: string): string => {
  const canonical = location.definition['canonical'] ?? location.definition['component'];
  return (typeof canonical === 'string' ? canonical : subject).toLowerCase();
};

const idsFor = (graph: KnowledgeGraph, location: SubjectLocation, subject: string): string[] => {
  if (location.subjectKind === 'detection') {
    return matchingNodeIds(graph, (node) => node.id.startsWith(`custom:${subject}:`));
  }
  if (location.subjectKind === 'alias' || location.subjectKind === 'exclusion') {
    const target = nameOf(location, subject);
    return matchingNodeIds(graph, (node) => node.name.toLowerCase() === target);
  }
  const patterns = globs(location);
  if (patterns.length === 0) {
    return [];
  }
  return matchingNodeIds(
    graph,
    (node) =>
      node.path !== undefined && patterns.some((pattern) => matchesGlob(node.path ?? '', pattern)),
  );
};

const RULE_DETAIL =
  'rules are evaluated against a review delta, not against the standing graph — run review_implementation to see violations';

/** What the value currently touches in the indexed graph; unindexed workspaces report zero. */
export const subjectImpact = async (
  rootDir: string,
  location: SubjectLocation,
  subject: string,
): Promise<SubjectImpact> => {
  if (location.subjectKind === 'rule') {
    return { nodeCount: 0, sampleNodeIds: [], detail: RULE_DETAIL };
  }
  const outcome = await withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    return { ok: true, value: idsFor(current.value.graph, location, subject) };
  });
  if (!outcome.ok) {
    return { nodeCount: 0, sampleNodeIds: [], detail: outcome.error.message };
  }
  return {
    nodeCount: outcome.value.length,
    sampleNodeIds: outcome.value.slice(0, SAMPLE_LIMIT),
    detail: `matches ${String(outcome.value.length)} node(s) in the current graph`,
  };
};
