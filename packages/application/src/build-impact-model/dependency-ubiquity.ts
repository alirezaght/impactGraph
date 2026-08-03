import type { GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Whether an external dependency is shared tooling rather than a discriminating anchor. Kept in
// its own module because the interesting part is the DENOMINATOR, and a bare ratio over "every
// package node in the graph" is wrong in two ways that both understate ubiquity: it mixes
// ecosystems (a Java package cannot declare an npm dependency, so counting it dilutes the share)
// and it counts vendored packages (test fixtures and examples nested inside another package are
// not peers of the workspace they sit in).
//
// Understating ubiquity is the dangerous direction: it lets a dependency every package declares
// anchor an impact, which is how one word in a sentence reaches most of a monorepo.

/** Above this share of eligible packages, a dependency is shared tooling. */
const UBIQUITOUS_DEPENDENCY_SHARE = 0.5;

/**
 * The share is meaningless below this many declarers: a single-package repository declares
 * everything in 100% of its packages. Being declared two or three times is not ubiquity at any
 * repository size, and refusing to anchor is the destructive outcome — so the floor wins ties.
 */
const MIN_DECLARERS_FOR_UBIQUITY = 4;

/** Manifest file name → ecosystem. A package's manifest is the only evidence of which it is. */
const ECOSYSTEM_BY_MANIFEST: Readonly<Record<string, string>> = {
  'package.json': 'npm',
  'pom.xml': 'maven',
  'build.gradle': 'gradle',
  'build.gradle.kts': 'gradle',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'setup.py': 'python',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
};

export interface UbiquityAssessment {
  readonly ubiquitous: boolean;
  readonly declarers: number;
  /** Packages that could declare this dependency: same ecosystem, not vendored. */
  readonly eligible: number;
  readonly reason: 'ubiquitous' | 'below-declarer-floor' | 'below-share' | 'ecosystem-unknown';
  /** Present when eligibility could not be established, so the caller can surface it. */
  readonly diagnostic?: string;
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const directoryOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

const ecosystemOf = (node: GraphNode): string | undefined =>
  node.path === undefined ? undefined : ECOSYSTEM_BY_MANIFEST[basename(node.path)];

const packageNodes = (graph: KnowledgeGraph): GraphNode[] => {
  const packages: GraphNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === 'package' && node.path !== undefined) {
      packages.push(node);
    }
  }
  return packages;
};

/**
 * Vendored: the package sits inside another package's directory. The repository root is excluded
 * as a container because every package nests under it, which would empty the denominator.
 */
const isVendored = (candidate: GraphNode, packages: readonly GraphNode[]): boolean => {
  const directory = directoryOf(candidate.path ?? '');
  if (directory === '') {
    return false;
  }
  return packages.some((other) => {
    const container = directoryOf(other.path ?? '');
    return other.id !== candidate.id && container !== '' && directory.startsWith(`${container}/`);
  });
};

const declaringPackages = (graph: KnowledgeGraph, dependency: GraphNode): GraphNode[] => {
  const declarers: GraphNode[] = [];
  for (const edgeId of graph.incoming.get(dependency.id) ?? []) {
    const edge = graph.edges.get(edgeId);
    if (edge?.type !== 'DEPENDS_ON') {
      continue;
    }
    const source = graph.nodes.get(edge.sourceId);
    if (source?.type === 'package') {
      declarers.push(source);
    }
  }
  return declarers;
};

/**
 * A dependency's ecosystem is the ecosystem of the packages declaring it — the manifest that
 * names a library is the only statement about which package manager owns it.
 */
export const assessUbiquity = (
  graph: KnowledgeGraph,
  dependency: GraphNode,
): UbiquityAssessment => {
  const declarers = declaringPackages(graph, dependency);
  const ecosystems = new Set(
    declarers.map((declarer) => ecosystemOf(declarer)).filter((value) => value !== undefined),
  );
  if (ecosystems.size === 0) {
    return {
      ubiquitous: false,
      declarers: declarers.length,
      eligible: 0,
      reason: 'ecosystem-unknown',
      diagnostic: `cannot tell which package manager owns '${dependency.name}', so it is treated as a specific component rather than shared tooling`,
    };
  }
  const packages = packageNodes(graph);
  const eligible = packages.filter((candidate) => {
    const ecosystem = ecosystemOf(candidate);
    return ecosystem !== undefined && ecosystems.has(ecosystem) && !isVendored(candidate, packages);
  }).length;
  if (declarers.length < MIN_DECLARERS_FOR_UBIQUITY) {
    return {
      ubiquitous: false,
      declarers: declarers.length,
      eligible,
      reason: 'below-declarer-floor',
    };
  }
  const ubiquitous = eligible > 0 && declarers.length / eligible >= UBIQUITOUS_DEPENDENCY_SHARE;
  return {
    ubiquitous,
    declarers: declarers.length,
    eligible,
    reason: ubiquitous ? 'ubiquitous' : 'below-share',
  };
};
