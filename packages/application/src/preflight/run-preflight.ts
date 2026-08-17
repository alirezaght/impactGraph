import { assessPlan, classifyUnmatchedRequirement } from '@impactgraph/domain';

import {
  configuredNamesByProcess,
  resolveRuntimePaths,
} from '../build-runtime-topology/resolve-runtime-paths.js';

import { checkAssumptions } from './check-assumptions.js';
import { checkConfigSemantics } from './check-config-semantics.js';
import { checkConstraints } from './check-constraints.js';
import { checkGuidance } from './check-guidance.js';
import { checkRuntime } from './check-runtime.js';
import { checkTestEnvironment } from './check-test-environment.js';
import { checkTypeComparisons } from './check-type-comparisons.js';
import { classifyRequirements } from './classify-requirements.js';
import { collapseAnalysisCaveats, collapseCaveatSpread } from './collapse-caveats.js';
import { deriveProposedEdges } from './proposed-edges.js';

import type { ConfigDeclaration } from './check-config-semantics.js';
import type { TestEnvironmentFact } from './check-test-environment.js';
import type { AnalogousLiteralMatch } from './check-type-comparisons.js';
import type { RequirementSignalInput } from './classify-requirements.js';
import type { ResolvedConcept } from './proposed-edges.js';
import type {
  ConfigRequirement,
  KnowledgeGraph,
  PlanAssessment,
  PreflightFinding,
  RepositoryConstraint,
  RequirementClassification,
} from '@impactgraph/domain';

/**
 * Run every architectural check, always.
 *
 * The trials failed not because the questions were unanswerable but because nobody knew to ask
 * them. "How does admin reach newsletter-service in production?" was answerable the whole time.
 * Making these checks optional tools would reproduce that failure exactly, so they are not tools —
 * they are what analysis IS.
 *
 * Each analyzer is independent and failure-isolated: one producing nothing degrades that check and
 * nothing else, which is the same discipline the deterministic core already applies to AI.
 */

export interface PreflightRequirement {
  readonly id: string;
  readonly label?: string;
  readonly statement: string;
  /** Components the requirement names, already resolved by concept matching. */
  readonly concepts: readonly ResolvedConcept[];
  /** True when the impact model produced at least one structural impact for it. */
  readonly hasStructuralImpact: boolean;
  readonly signals: RequirementSignalInput;
}

export interface RunPreflightInput {
  readonly requirements: readonly PreflightRequirement[];
  readonly graph: KnowledgeGraph;
  /**
   * The raw specification text, for the checks that read shapes requirement extraction drops —
   * fenced SQL above all (ADR-0020 §4). Absent means those checks stay silent, never guessed.
   */
  readonly specificationText?: string;
  /**
   * Correctly-handled SQL literals found elsewhere in the repository, computed by the CALLER
   * (workspace-engine owns the fragment cache; application must not reach into it). Purely
   * advisory: they enrich a type-comparison recommendation and can never create a finding.
   */
  readonly analogousLiterals?: readonly AnalogousLiteralMatch[];
  readonly constraints: readonly RepositoryConstraint[];
  /**
   * Test-scoped database declarations, read from test config files by the CALLER (file access is
   * the engine's job). Empty means "no test environment is stated", which produces silence.
   */
  readonly testEnvironments?: readonly TestEnvironmentFact[];
  /** Configuration the plan requires along the request path. */
  readonly configRequirements: readonly ConfigRequirement[];
  /** Declarations for those values, where the adapters could read them. */
  readonly configDeclarations: readonly ConfigDeclaration[];
  /** Node ids the plan itself proposes to configure. */
  readonly planConfiguredNodeIds: ReadonlySet<string>;
  readonly blockingQuestions: number;
  readonly coverageInsufficient: boolean;
  readonly score?: number;
  /** Why the caller withheld the score, when it deliberately computed none. */
  readonly scoreWithheldReason?: string;
  readonly nextId: (seed: string) => string;
}

export interface PreflightResult {
  readonly findings: readonly PreflightFinding[];
  readonly classifications: readonly RequirementClassification[];
  readonly assessment: PlanAssessment;
}

/**
 * The analyzers this pass runs, in order. Exported so a consumer reporting "nothing was found"
 * can state what LOOKED — an empty finding list is only meaningful next to this roster.
 */
export const PREFLIGHT_ANALYZERS = [
  'check-constraints',
  'check-guidance',
  'check-assumptions',
  'check-type-comparisons',
  'check-runtime',
  'check-config-semantics',
  'classify-requirements',
] as const;

/** Strongest first, so a bounded report shows what decides the verdict. */
const SEVERITY_ORDER = { blocking: 0, warning: 1, informational: 2 } as const;

const byImportance = (a: PreflightFinding, b: PreflightFinding): number => {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return bySeverity !== 0 ? bySeverity : b.confidence - a.confidence;
};

/**
 * Runtime paths are resolved only for URLs the plan actually touches. Walking every URL in a large
 * repository would bury one real gap under a hundred paths nobody proposed to change.
 */
const relevantUrlPattern = (requirements: readonly PreflightRequirement[]): RegExp | undefined => {
  const names = requirements
    .flatMap((requirement) => requirement.concepts.map((concept) => concept.ref))
    .map((ref) => ref.replace(/[^A-Za-z0-9]+/g, '.?'))
    .filter((ref) => ref.length >= 4);
  return names.length === 0 ? undefined : new RegExp(names.join('|'), 'i');
};

/** The checks that read the plan's proposed relationships and the symbols it asserts. */
const designFindings = (input: RunPreflightInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  const proposedEdges = input.requirements.flatMap((requirement) =>
    deriveProposedEdges({
      requirementId: requirement.label ?? requirement.id,
      statement: requirement.statement,
      concepts: requirement.concepts,
    }),
  );
  findings.push(
    ...checkConstraints({
      proposedEdges,
      constraints: input.constraints,
      nextId: input.nextId,
    }),
  );
  findings.push(
    ...checkGuidance({
      requirements: input.requirements.map((requirement) => ({
        id: requirement.label ?? requirement.id,
        concepts: requirement.concepts,
      })),
      constraints: input.constraints,
      nextId: input.nextId,
    }),
  );
  for (const requirement of input.requirements) {
    findings.push(
      ...checkAssumptions({
        requirementId: requirement.label ?? requirement.id,
        statement: requirement.statement,
        graph: input.graph,
        nextId: input.nextId,
      }),
    );
  }
  findings.push(...rawTextFindings(input));
  return findings;
};

/**
 * The checks that read the RAW specification text, not per-requirement statements — the SQL that
 * motivated ADR-0020 §4 lives in fenced blocks the requirement extractor does not carry. Absent
 * text means these checks stay silent, never guessed.
 */
const rawTextFindings = (input: RunPreflightInput): readonly PreflightFinding[] => {
  if (input.specificationText === undefined) {
    return [];
  }
  const requirementIds = input.requirements.map(
    (requirement) => requirement.label ?? requirement.id,
  );
  return [
    ...checkTestEnvironment({
      specificationText: input.specificationText,
      testEnvironments: input.testEnvironments ?? [],
      requirementIds,
      nextId: input.nextId,
    }),
    ...checkTypeComparisons({
      specificationText: input.specificationText,
      graph: input.graph,
      requirementIds,
      ...(input.analogousLiterals === undefined
        ? {}
        : { analogousLiterals: input.analogousLiterals }),
      nextId: input.nextId,
    }),
  ];
};

/** The checks that read the deployment topology and the configuration it carries. */
const deploymentFindings = (input: RunPreflightInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  const urlPattern = relevantUrlPattern(input.requirements);
  const paths = resolveRuntimePaths({
    graph: input.graph,
    ...(urlPattern === undefined ? {} : { urlNamePattern: urlPattern }),
  });
  findings.push(
    ...checkRuntime({
      paths,
      requirements: input.configRequirements,
      configuredByProcess: configuredNamesByProcess(input.graph),
      planConfiguredNodeIds: input.planConfiguredNodeIds,
      requirementIds: input.requirements.map((requirement) => requirement.label ?? requirement.id),
      nextId: input.nextId,
    }),
  );

  findings.push(
    ...checkConfigSemantics({
      declarations: input.configDeclarations,
      requirementIds: input.requirements.map((requirement) => requirement.label ?? requirement.id),
      nextId: input.nextId,
    }),
  );
  return findings;
};

export const runPreflight = (input: RunPreflightInput): PreflightResult => {
  const findings: PreflightFinding[] = [...designFindings(input), ...deploymentFindings(input)];
  const unmatched = input.requirements.filter((requirement) => !requirement.hasStructuralImpact);
  const classifications = unmatched.map((requirement) =>
    classifyUnmatchedRequirement(requirement.label ?? requirement.id, {
      ...requirement.signals,
      // An invalid assumption already found by the assumption analyzer is a stronger fact than any
      // lexical signal, so it is fed back into classification rather than being decided twice.
      hasInvalidSymbolAssumption:
        requirement.signals.hasInvalidSymbolAssumption ||
        findings.some(
          (finding) =>
            finding.kind === 'invalid-assumption' &&
            finding.requirementIds.includes(requirement.label ?? requirement.id),
        ),
    }),
  );
  findings.push(
    ...classifyRequirements({
      requirements: unmatched.map((requirement) => ({
        id: requirement.label ?? requirement.id,
        statement: requirement.statement,
      })),
      classifications,
      nextId: input.nextId,
    }),
  );

  // ADR-0023: collapse before assessing, so one unreadable deployment chain counts once and the
  // plan's own findings are never crowded out by the analysis talking about itself.
  const sorted = [...collapseCaveatSpread(collapseAnalysisCaveats(findings))].sort(byImportance);
  return {
    findings: sorted,
    classifications,
    assessment: assessPlan({
      findings: sorted,
      classifications,
      expectedChangeSurfaces: input.requirements.filter(
        (requirement) => requirement.hasStructuralImpact,
      ).length,
      blockingQuestions: input.blockingQuestions,
      coverageInsufficient: input.coverageInsufficient,
      ...(input.score === undefined ? {} : { score: input.score }),
      ...(input.scoreWithheldReason === undefined
        ? {}
        : { scoreWithheldReason: input.scoreWithheldReason }),
    }),
  };
};
