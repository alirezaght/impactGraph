import { matchesGlob } from '@impactgraph/application';

import {
  bestOf,
  levelForProvenance,
  levelForSource,
  precedenceRank,
  provenanceForLevel,
  resolved,
} from './overlay-precedence.js';

import type { PrecedenceLevel, Resolved } from './overlay-precedence.js';
import type { ArchitectureConfigDto, ComponentMarkerDto } from '@impactgraph/contracts';
import type { GraphNode } from '@impactgraph/domain';

// §16 component corrections resolved against one graph node, at read time. The node is never
// modified: every field is answered as "this value, from this §Z5 level, with this provenance".

export interface EffectiveMarker {
  readonly marker: ComponentMarkerDto;
  readonly level: PrecedenceLevel;
  readonly rank: number;
  readonly provenance: string;
  readonly detail: string;
}

export interface EffectiveComponent {
  readonly nodeId: string;
  /** The deterministic graph name, always kept — a rename overlays it, never replaces it. */
  readonly graphName: string;
  readonly name: Resolved<string>;
  readonly role: Resolved<string | undefined>;
  readonly context: Resolved<string | undefined>;
  /** §16 ownership. Only levels 1/2 (committed config) and 6 (defaults) are ever produced. */
  readonly owner: Resolved<string | undefined>;
  readonly markers: readonly EffectiveMarker[];
  readonly mergedWithNodeIds: readonly string[];
}

/** One package's directory, for the §Z5 level-3 "repository-native metadata" fallback. */
export interface PackageDirectory {
  readonly directory: string;
  readonly name: string;
  readonly provenance: string;
}

export interface ComponentOverlayInputs {
  readonly architecture: ArchitectureConfigDto;
  readonly packages: readonly PackageDirectory[];
}

/**
 * Level 4: node categories that name an architectural layer are a deterministic role signal
 * (§12.1). Categories that only say "where the code lives" (repository, application, intent)
 * carry no role and fall through to defaults.
 */
const ROLE_BY_CATEGORY: Readonly<Record<string, string>> = {
  domain: 'domain',
  infrastructure: 'infrastructure',
  data: 'data',
  integration: 'integration',
};

const assignmentsFor = (
  inputs: ComponentOverlayInputs,
  path: string | undefined,
): NonNullable<ArchitectureConfigDto['components']> =>
  path === undefined
    ? []
    : (inputs.architecture.components ?? []).filter((entry) => matchesGlob(path, entry.path));

const owningPackage = (
  inputs: ComponentOverlayInputs,
  path: string | undefined,
): PackageDirectory | undefined => {
  if (path === undefined) {
    return undefined;
  }
  let best: PackageDirectory | undefined;
  for (const entry of inputs.packages) {
    const inside = entry.directory === '' || path.startsWith(`${entry.directory}/`);
    if (inside && (best === undefined || entry.directory.length > best.directory.length)) {
      best = entry;
    }
  }
  return best;
};

const resolveName = (node: GraphNode, inputs: ComponentOverlayInputs): Resolved<string> => {
  const rename = (inputs.architecture.renames ?? []).find((entry) => entry.from === node.name);
  if (rename !== undefined) {
    const level = levelForSource(rename.source);
    return resolved(rename.to, level, `renamed from '${rename.from}' — ${rename.reason}`);
  }
  return resolved(
    node.name,
    levelForProvenance(node.knowledge.provenance),
    'name as detected in the repository',
    node.knowledge.provenance,
  );
};

const resolveRole = (
  node: GraphNode,
  assignments: NonNullable<ArchitectureConfigDto['components']>,
): Resolved<string | undefined> => {
  // Weakest candidate first: `bestOf` breaks ties in favour of the later entry, so committed
  // configuration wins over a same-level detection and later config entries win over earlier ones.
  const candidates: Resolved<string | undefined>[] = [];
  const detected = ROLE_BY_CATEGORY[node.category];
  if (detected !== undefined) {
    candidates.push(
      resolved(
        detected,
        levelForProvenance(node.knowledge.provenance),
        `node category '${node.category}'`,
        node.knowledge.provenance,
      ),
    );
  }
  for (const entry of assignments) {
    if (entry.role !== undefined) {
      candidates.push(
        resolved(entry.role, levelForSource(entry.source), `architecture.yml: ${entry.path}`),
      );
    }
  }
  return bestOf(candidates) ?? resolved(undefined, 'defaults', 'no role assigned or detected');
};

const contextGlobCandidates = (
  inputs: ComponentOverlayInputs,
  path: string | undefined,
): Resolved<string | undefined>[] =>
  path === undefined
    ? []
    : (inputs.architecture.contexts ?? [])
        .filter((context) => context.paths.some((glob) => matchesGlob(path, glob)))
        .map((context) =>
          resolved(
            context.name,
            levelForSource(context.source),
            `architecture.yml context '${context.name}' path glob`,
          ),
        );

const resolveContext = (
  node: GraphNode,
  inputs: ComponentOverlayInputs,
  assignments: NonNullable<ArchitectureConfigDto['components']>,
): Resolved<string | undefined> => {
  // Weakest first (see resolveRole): package metadata, then context globs, then the component
  // entry — so an explicit component assignment wins the tie against a context glob.
  const candidates: Resolved<string | undefined>[] = [];
  const owner = owningPackage(inputs, node.path);
  if (owner !== undefined) {
    candidates.push(
      resolved(
        owner.name,
        levelForProvenance(owner.provenance),
        `owning package '${owner.name}' (repository-native metadata)`,
        owner.provenance,
      ),
    );
  }
  candidates.push(...contextGlobCandidates(inputs, node.path));
  for (const entry of assignments) {
    if (entry.context !== undefined) {
      candidates.push(
        resolved(entry.context, levelForSource(entry.source), `architecture.yml: ${entry.path}`),
      );
    }
  }
  return bestOf(candidates) ?? resolved(undefined, 'defaults', 'no context assigned or detected');
};

/**
 * §16 ownership through the §Z5 ladder. There is deliberately NO candidate below level 2: no node
 * category, no package manifest, no git history, no model output contributes an owner. `git blame`
 * answers "who last touched this file", which is not "who owns it" — so an unowned component
 * resolves at `defaults` and stays visibly unowned instead of being filled in with a guess.
 */
const resolveOwner = (
  assignments: NonNullable<ArchitectureConfigDto['components']>,
): Resolved<string | undefined> => {
  const candidates: Resolved<string | undefined>[] = [];
  for (const entry of assignments) {
    if (entry.owner !== undefined) {
      candidates.push(
        resolved(entry.owner, levelForSource(entry.source), `architecture.yml: ${entry.path}`),
      );
    }
  }
  return (
    bestOf(candidates) ??
    resolved(undefined, 'defaults', 'no owner assigned — ownership is asserted, never inferred')
  );
};

const resolveMarkers = (
  assignments: NonNullable<ArchitectureConfigDto['components']>,
): EffectiveMarker[] => {
  const seen = new Map<ComponentMarkerDto, EffectiveMarker>();
  for (const entry of assignments) {
    for (const marker of entry.markers ?? []) {
      const level = levelForSource(entry.source);
      const candidate: EffectiveMarker = {
        marker,
        level,
        rank: precedenceRank(level),
        provenance: provenanceForLevel(level),
        detail: `architecture.yml: ${entry.path}`,
      };
      const existing = seen.get(marker);
      if (existing === undefined || candidate.rank < existing.rank) {
        seen.set(marker, candidate);
      }
    }
  }
  return [...seen.values()];
};

export const resolveComponent = (
  node: GraphNode,
  inputs: ComponentOverlayInputs,
): EffectiveComponent => {
  const assignments = assignmentsFor(inputs, node.path);
  return {
    nodeId: node.id,
    graphName: node.name,
    name: resolveName(node, inputs),
    role: resolveRole(node, assignments),
    context: resolveContext(node, inputs, assignments),
    owner: resolveOwner(assignments),
    markers: resolveMarkers(assignments),
    mergedWithNodeIds: [],
  };
};
