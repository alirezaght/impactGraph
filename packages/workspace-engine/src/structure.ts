import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { componentOf, overlayFor } from './overlay.js';

import type { Failable } from './failure.js';
import type { EffectiveView } from './overlay.js';
import type { ComponentMarkerDto, ConfigPrecedenceLevelDto } from '@impactgraph/contracts';
import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// `detect_repository_structure` (§Z7) — a projection of the CURRENT deterministic graph, never
// a re-scan: package nodes plus the generic-discovery facts of §15.1 (CONTAINS → `directory`
// roots, CONFIGURES ← build config files, EXPOSES → manifest entry points). Read-only.

const DIRECTORY_PREFIX = 'directory:';
const FILE_PREFIX = 'file:';
const TEST_ROOT_NAMES = new Set(['test', 'tests', '__tests__', 'spec']);

export interface PackageStructure {
  readonly nodeId: string;
  readonly name: string;
  readonly directory: string;
  readonly manifestPath?: string | undefined;
  readonly sourceRoots: readonly string[];
  readonly testRoots: readonly string[];
  readonly buildConfigFiles: readonly string[];
  readonly entryPoints: readonly string[];
  readonly fileCount: number;
  /** §16/§Z5 overlay: `name` stays the detected name, these report the committed corrections. */
  readonly effectiveName: string;
  readonly role?: string | undefined;
  readonly context?: string | undefined;
  /** §16 committed ownership — who to talk to. Never inferred from the repository. */
  readonly owner?: string | undefined;
  readonly markers: readonly ComponentMarkerDto[];
  readonly correctionLevels: readonly ConfigPrecedenceLevelDto[];
}

export interface RepositoryStructure {
  readonly snapshotId: string;
  readonly workspaces: readonly string[];
  readonly packages: readonly PackageStructure[];
  readonly totals: {
    readonly packages: number;
    readonly sourceRoots: number;
    readonly testRoots: number;
    readonly buildConfigFiles: number;
    readonly entryPoints: number;
  };
}

interface EdgeIndex {
  readonly directories: Map<string, string[]>;
  readonly buildConfigFiles: Map<string, string[]>;
  readonly entryPoints: Map<string, string[]>;
  readonly fileCounts: Map<string, number>;
}

const push = (into: Map<string, string[]>, key: string, value: string): void => {
  const current = into.get(key);
  if (current === undefined) {
    into.set(key, [value]);
    return;
  }
  current.push(value);
};

/** A package CONTAINS both its discovered roots (`directory:`) and its files (`file:`). */
const addContains = (index: EdgeIndex, edge: { sourceId: string; targetId: string }): void => {
  if (edge.targetId.startsWith(DIRECTORY_PREFIX)) {
    push(index.directories, edge.sourceId, edge.targetId.slice(DIRECTORY_PREFIX.length));
    return;
  }
  if (edge.targetId.startsWith(FILE_PREFIX)) {
    index.fileCounts.set(edge.sourceId, (index.fileCounts.get(edge.sourceId) ?? 0) + 1);
  }
};

const indexEdges = (graph: KnowledgeGraph): EdgeIndex => {
  const index: EdgeIndex = {
    directories: new Map(),
    buildConfigFiles: new Map(),
    entryPoints: new Map(),
    fileCounts: new Map(),
  };
  for (const edge of graph.edges.values()) {
    if (edge.type === 'CONTAINS') {
      addContains(index, edge);
    } else if (edge.type === 'CONFIGURES' && edge.sourceId.startsWith(FILE_PREFIX)) {
      push(index.buildConfigFiles, edge.targetId, edge.sourceId.slice(FILE_PREFIX.length));
    } else if (edge.type === 'EXPOSES' && edge.targetId.startsWith(FILE_PREFIX)) {
      push(index.entryPoints, edge.sourceId, edge.targetId.slice(FILE_PREFIX.length));
    }
  }
  return index;
};

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Package nodes carry their manifest path; the owning directory is what contexts glob on. */
const directoryOf = (manifestPath: string | undefined): string => {
  if (manifestPath === undefined || !manifestPath.includes('/')) {
    return '';
  }
  return manifestPath.slice(0, manifestPath.lastIndexOf('/'));
};

const structureOf = (
  node: GraphNode,
  index: EdgeIndex,
  overlay: EffectiveView,
): PackageStructure => {
  const roots = [...(index.directories.get(node.id) ?? [])].sort();
  const effective = componentOf(overlay, node.id);
  return {
    nodeId: node.id,
    name: node.name,
    directory: directoryOf(node.path),
    manifestPath: node.path,
    sourceRoots: roots.filter((path) => !TEST_ROOT_NAMES.has(baseName(path))),
    testRoots: roots.filter((path) => TEST_ROOT_NAMES.has(baseName(path))),
    buildConfigFiles: [...(index.buildConfigFiles.get(node.id) ?? [])].sort(),
    entryPoints: [...(index.entryPoints.get(node.id) ?? [])].sort(),
    fileCount: index.fileCounts.get(node.id) ?? 0,
    effectiveName: effective.name.value,
    role: effective.role.value,
    context: effective.context.value,
    owner: effective.owner.value,
    markers: effective.markers.map((entry) => entry.marker),
    correctionLevels: [
      ...new Set([
        effective.name.level,
        effective.role.level,
        effective.context.level,
        effective.owner.level,
        ...effective.markers.map((entry) => entry.level),
      ]),
    ],
  };
};

const sumBy = (
  packages: readonly PackageStructure[],
  pick: (entry: PackageStructure) => readonly string[],
): number => packages.reduce((total, entry) => total + pick(entry).length, 0);

/** §Z7 `detect_repository_structure`: deterministic layout facts, no inference, no writes. */
export const summarizeRepositoryStructure = async (
  rootDir: string,
): Promise<Failable<RepositoryStructure>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    const index = indexEdges(graph);
    const overlay = overlayFor(rootDir, graph);
    const nodes = [...graph.nodes.values()];
    const packages = nodes
      .filter((node) => node.type === 'package')
      .map((node) => structureOf(node, index, overlay))
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      ok: true,
      value: {
        snapshotId: current.value.snapshotId,
        workspaces: nodes
          .filter((node) => node.type === 'workspace')
          .map((node) => node.name)
          .sort(),
        packages,
        totals: {
          packages: packages.length,
          sourceRoots: sumBy(packages, (entry) => entry.sourceRoots),
          testRoots: sumBy(packages, (entry) => entry.testRoots),
          buildConfigFiles: sumBy(packages, (entry) => entry.buildConfigFiles),
          entryPoints: sumBy(packages, (entry) => entry.entryPoints),
        },
      },
    };
  });
