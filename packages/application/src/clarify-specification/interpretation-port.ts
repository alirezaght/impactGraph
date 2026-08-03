import type { ModelProviderError } from '../ports/model-provider.js';
import type { Requirement, Result } from '@impactgraph/domain';

/** One architectural reading of a requirement (PRD §C4). */
export interface InterpretationDraft {
  readonly title: string;
  readonly assumption: string;
  readonly concepts: readonly string[];
}

/**
 * Interpretation generation behind a port: the application pipeline stays provider-agnostic
 * and fully skips clarification when no provider is configured (PRD §8, §C3).
 */
export interface SpecificationInterpretationPort {
  interpret(
    requirement: Requirement,
    specificationTitle: string,
  ): Promise<Result<readonly InterpretationDraft[], ModelProviderError>>;
}
