import type { SpecificationPanelStateDto } from '@impactgraph/contracts';
import type { ReadinessReport, Specification } from '@impactgraph/domain';

// Story 9.1 — pure projection of a stored Specification onto the §18.2 panel DTO. No vscode
// types: unit-tested without Electron, and reused by the engine worker so the document that
// crosses IPC is already the contract shape (the host still validates it, ADR-0009).

export const EMPTY_SPECIFICATION_STATE: SpecificationPanelStateDto = {
  schemaVersion: 1,
  status: 'empty',
  requirements: [],
  openQuestions: [],
  availableVersions: [],
  warnings: [],
};

const versionsUpTo = (version: number): number[] =>
  Array.from({ length: version }, (_unused, index) => index + 1);

export interface SpecificationStateInput {
  readonly specification: Specification;
  readonly readiness?: ReadinessReport | undefined;
  readonly extractionMode?: 'provider' | 'deterministic-fallback' | 'unchanged' | undefined;
  readonly warnings?: readonly string[] | undefined;
}

/**
 * Requirements and open questions stay separate lists, exactly as the specification models them
 * (§18.2): a question is never folded into the requirement it questions.
 */
export const buildSpecificationState = (
  input: SpecificationStateInput,
): SpecificationPanelStateDto => {
  const spec = input.specification;
  return {
    schemaVersion: 1,
    status: 'loaded',
    specification: {
      id: spec.id,
      version: spec.version,
      title: spec.title,
      rawText: spec.rawText,
      ...(input.extractionMode === undefined ? {} : { extractionMode: input.extractionMode }),
      updatedAt: spec.updatedAt,
    },
    requirements: spec.requirements.map((requirement) => ({
      id: requirement.id,
      statement: requirement.statement,
      type: requirement.type,
      status: requirement.status,
      concepts: [...requirement.concepts],
      actors: [...requirement.actors],
      ...(requirement.priority === undefined ? {} : { priority: requirement.priority }),
    })),
    openQuestions: spec.openQuestions.map((question) => ({
      id: question.id,
      question: question.question,
      reason: question.reason,
      severity: question.severity,
      status: question.status,
      ...(question.answer === undefined ? {} : { answer: question.answer }),
      affectedRequirementIds: [...question.affectedRequirementIds],
    })),
    ...(input.readiness === undefined ? {} : { readiness: { ...input.readiness } }),
    availableVersions: versionsUpTo(spec.version),
    warnings: [...(input.warnings ?? [])],
  };
};
