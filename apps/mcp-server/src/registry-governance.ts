import {
  configuredNamesByProcess,
  failWith,
  latestPreflightArtifact,
  loadConstraints,
  loadCurrentGraph,
  loadPreflightArtifact,
  PREFLIGHT_ANALYZERS,
  resolveRuntimePaths,
  toConstraintSummary,
  withIndexStore,
} from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';

/**
 * The governance and runtime tools.
 *
 * These exist as tools in addition to running inside analysis, for one reason: a reviewer who has
 * just been told a plan is BLOCKED needs to read the rule that blocked it, and a reviewer told a
 * process is missing configuration needs to walk the path themselves. Neither is a question the
 * user has to know to ask in advance — analysis already asked it — but both are questions they will
 * want to check the answer to.
 */

const currentGraph = async (rootDir: string) =>
  withIndexStore(rootDir, async (store) => loadCurrentGraph(store));

const listConstraints: ToolHandler<'list_constraints'> = async (rootDir, input) => {
  const loaded = await currentGraph(rootDir);
  if (!loaded.ok) {
    return loaded;
  }
  const constraints = loadConstraints(
    rootDir,
    loaded.value.graph,
    loaded.value.snapshotId,
    new Date().toISOString(),
  );
  const filtered = constraints.constraints
    .filter((entry) => input.severity === undefined || entry.severity === input.severity)
    .filter((entry) => input.kind === undefined || entry.kind === input.kind);
  const limit = input.limit ?? 50;
  return {
    ok: true,
    value: {
      constraints: filtered.slice(0, limit).map(toConstraintSummary),
      totalCount: filtered.length,
      opaqueGuardPaths: [...constraints.opaqueGuardPaths],
      guardFilesRead: constraints.guardFileCount,
    },
  };
};

const queryRuntimePath: ToolHandler<'query_runtime_path'> = async (rootDir, input) => {
  const loaded = await currentGraph(rootDir);
  if (!loaded.ok) {
    return loaded;
  }
  const graph = loaded.value.graph;
  const pattern =
    input.urlName === undefined
      ? undefined
      : new RegExp(input.urlName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const paths = resolveRuntimePaths({
    graph,
    ...(pattern === undefined ? {} : { urlNamePattern: pattern }),
  });
  const configured = configuredNamesByProcess(graph);
  const limit = input.limit ?? 20;
  return {
    ok: true,
    value: {
      paths: paths.slice(0, limit).map((path) => {
        // The LAST process hop is the one that actually runs the code — the aggregator, not the
        // service the URL is named after. Reporting the first would restate the plan's assumption.
        const serving = [...path.hops].reverse().find((hop) => hop.kind === 'process');
        return {
          id: path.id,
          hops: path.hops.map((hop) => ({
            kind: hop.kind,
            nodeId: hop.nodeId,
            name: hop.name,
            ...(hop.viaRelation === undefined ? {} : { viaRelation: hop.viaRelation }),
          })),
          ...(serving === undefined ? {} : { servingProcess: serving.name }),
          receivedEnvironment:
            serving === undefined ? [] : [...(configured.get(serving.nodeId) ?? [])].sort(),
          ...(path.incompleteReason === undefined
            ? {}
            : { incompleteReason: path.incompleteReason }),
        };
      }),
      totalCount: paths.length,
    },
  };
};

/**
 * The explicit red-team view. Analysis already red-teams unconditionally; this tool serves the
 * FULL case — every finding, not the bounded summary slice — for "I understand the blast radius,
 * attack the design" follow-ups, and states what was checked so an empty list is auditable.
 */
const listPreflightFindings: ToolHandler<'list_preflight_findings'> = (rootDir, input) => {
  const loaded =
    input.analysisId === undefined
      ? latestPreflightArtifact(rootDir)
      : loadPreflightArtifact(rootDir, input.analysisId);
  if (!loaded.ok) {
    return Promise.resolve(loaded);
  }
  if (loaded.value === undefined) {
    return Promise.resolve(
      failWith(
        'configurationError',
        input.analysisId === undefined
          ? 'no analysis has been run in this workspace — call analyze_impact first'
          : `no preflight outcome is stored for analysis '${input.analysisId}' — it may predate the adversarial pass; re-run analyze_impact`,
      ),
    );
  }
  const artifact = loaded.value;
  const findings = artifact.findings
    .filter((finding) => input.severity === undefined || finding.severity === input.severity)
    .filter((finding) => input.kind === undefined || finding.kind === input.kind);
  return Promise.resolve({
    ok: true as const,
    value: {
      analysisId: artifact.analysisId,
      specificationId: artifact.specificationId,
      specificationVersion: artifact.specificationVersion,
      repositorySnapshotId: artifact.repositorySnapshotId,
      createdAt: artifact.createdAt,
      assessment: artifact.assessment,
      findings,
      totalCount: artifact.findings.length,
      classifications: [...artifact.classifications],
      evidenceIndependence: artifact.evidenceIndependence,
      checked: {
        analyzers: [...PREFLIGHT_ANALYZERS],
        indexedConstraintCount: artifact.constraintCoverage.indexedConstraintCount,
        opaqueGuardPaths: [...artifact.constraintCoverage.opaqueGuardPaths],
      },
    },
  });
};

export const GOVERNANCE_HANDLERS = {
  list_constraints: listConstraints,
  list_preflight_findings: listPreflightFindings,
  query_runtime_path: queryRuntimePath,
} as const;
