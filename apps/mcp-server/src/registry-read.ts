import {
  computeReadiness,
  serializeImpactAnalysis,
  serializeSpecification,
} from '@impactgraph/domain';
import { loadAnalysis, loadSpecification } from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';

// Read-only specification/analysis tools (Story 12.1). Documents leave the server as the
// domain-serialized artifact JSON — the same bytes the append-only stores hold.

const specificationDocument: ToolHandler<'get_specification'> = async (rootDir, input) => {
  const spec = await loadSpecification(rootDir, input.specificationId, input.version);
  if (!spec.ok) {
    return spec;
  }
  return { ok: true, value: { ...serializeSpecification(spec.value) } };
};

const requirements: ToolHandler<'extract_requirements'> = async (rootDir, input) => {
  const spec = await loadSpecification(rootDir, input.specificationId);
  if (!spec.ok) {
    return spec;
  }
  return {
    ok: true,
    value: {
      specificationId: spec.value.id,
      version: spec.value.version,
      requirements: spec.value.requirements.map((requirement) => ({
        id: requirement.id,
        statement: requirement.statement,
        type: requirement.type,
        concepts: [...requirement.concepts],
        actors: [...requirement.actors],
        ...(requirement.priority === undefined ? {} : { priority: requirement.priority }),
        status: requirement.status,
      })),
    },
  };
};

const openQuestions: ToolHandler<'get_open_questions'> = async (rootDir, input) => {
  const spec = await loadSpecification(rootDir, input.specificationId);
  if (!spec.ok) {
    return spec;
  }
  return {
    ok: true,
    value: {
      specificationId: spec.value.id,
      version: spec.value.version,
      readiness: computeReadiness(spec.value),
      openQuestions: spec.value.openQuestions.map((question) => ({
        id: question.id,
        question: question.question,
        reason: question.reason,
        affectedRequirementIds: [...question.affectedRequirementIds],
        severity: question.severity,
        status: question.status,
        ...(question.answer === undefined ? {} : { answer: question.answer }),
      })),
    },
  };
};

const analysisDocument: ToolHandler<'get_impact_analysis'> = async (rootDir, input) => {
  const analysis = await loadAnalysis(rootDir, input.analysisId);
  if (!analysis.ok) {
    return analysis;
  }
  return { ok: true, value: { ...serializeImpactAnalysis(analysis.value) } };
};

export const HANDLER_EXTENSIONS = {
  get_specification: specificationDocument,
  extract_requirements: requirements,
  get_open_questions: openQuestions,
  get_impact_analysis: analysisDocument,
} as const;
