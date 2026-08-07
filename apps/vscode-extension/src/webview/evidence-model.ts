import type {
  CliAnalyzeOutput,
  EvidencePanelStateDto,
  HumanDecisionDto,
  NodeExplanationDto,
} from '@impactgraph/contracts';

// Story 9.3 — pure projection onto the §18.5 evidence DTO. Every field the panel shows comes
// from the analyze document or from `explain_node`; nothing is defaulted to a reassuring value.
// When a piece is missing the DTO simply omits it and the panel renders it as absent (§43.6).

const TEST_PATH = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go|java)$/i;

/**
 * Test files AMONG THE EVIDENCE — a path-shaped grouping of files the engine already cited,
 * never a claim that these tests cover the impact.
 */
export const relatedTestFiles = (evidenceFiles: readonly string[]): string[] =>
  evidenceFiles.filter((file) => TEST_PATH.test(file));

export const EMPTY_EVIDENCE_STATE: EvidencePanelStateDto = {
  schemaVersion: 1,
  status: 'empty',
  message: 'Select an impact in the tree or the graph to see its evidence.',
  humanDecisions: [],
  warnings: [],
};

export const unavailableEvidence = (message: string): EvidencePanelStateDto => ({
  schemaVersion: 1,
  status: 'unavailable',
  message,
  humanDecisions: [],
  warnings: [],
});

interface EvidenceInput {
  readonly document: CliAnalyzeOutput | undefined;
  readonly nodeId: string;
  readonly requirementId?: string | undefined;
  readonly explanation?: NodeExplanationDto | undefined;
  readonly decisions?: readonly HumanDecisionDto[] | undefined;
  readonly warnings?: readonly string[] | undefined;
}

const findImpact = (
  document: CliAnalyzeOutput | undefined,
  nodeId: string,
  requirementId: string | undefined,
): EvidencePanelStateDto['impact'] => {
  if (document === undefined) {
    return undefined;
  }
  for (const requirement of document.requirements) {
    if (requirementId !== undefined && requirement.id !== requirementId) {
      continue;
    }
    const impact = requirement.impacts.find((candidate) => candidate.nodeId === nodeId);
    if (impact === undefined) {
      continue;
    }
    return {
      analysisId: document.analysis.id,
      requirementId: requirement.id,
      requirementStatement: requirement.statement,
      expectedChange: impact.impactType,
      likelihood: impact.likelihood,
      directness: impact.directness,
      confidence: impact.confidence,
      ...(impact.provenance === undefined ? {} : { provenance: impact.provenance }),
      dependencyPath: [...impact.dependencyPath],
      evidenceFiles: [...impact.evidenceFiles],
      relatedTests: relatedTestFiles(impact.evidenceFiles),
      // ADR-0015: basis and tier cap pass through untouched — absence stays absence.
      ...(impact.evidenceTypes === undefined ? {} : { evidenceTypes: [...impact.evidenceTypes] }),
      ...(impact.tierCappedBy === undefined ? {} : { tierCappedBy: impact.tierCappedBy }),
    };
  }
  return undefined;
};

/** Display name: the graph's own name wins; the analysis name is the fallback. */
const displayName = (input: EvidenceInput): string => {
  if (input.explanation !== undefined) {
    return input.explanation.name;
  }
  for (const requirement of input.document?.requirements ?? []) {
    const impact = requirement.impacts.find((candidate) => candidate.nodeId === input.nodeId);
    if (impact !== undefined) {
      return impact.name;
    }
  }
  return input.nodeId;
};

export const buildEvidenceState = (input: EvidenceInput): EvidencePanelStateDto => {
  const impact = findImpact(input.document, input.nodeId, input.requirementId);
  const warnings = [...(input.warnings ?? [])];
  if (impact === undefined) {
    warnings.push(
      'This node is not part of the current analysis — showing repository knowledge only.',
    );
  }
  if (input.explanation === undefined) {
    warnings.push('Graph explanation unavailable — confidence signals and edges are not shown.');
  }
  return {
    schemaVersion: 1,
    status: 'loaded',
    target: {
      nodeId: input.nodeId,
      name: displayName(input),
      ...(input.explanation?.path === undefined ? {} : { path: input.explanation.path }),
    },
    ...(impact === undefined ? {} : { impact }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
    humanDecisions: [...(input.decisions ?? [])],
    warnings,
  };
};
