import type { ModelProviderError } from '../ports/model-provider.js';
import type { Result } from '@impactgraph/domain';

// Neutral extraction draft shapes — the port contract between this use case and the
// AI-inference adapter (which owns prompts, DTO validation, and mapping). Values are strings
// here; the domain factories are the semantic gate when the draft becomes a Specification.

export interface ExtractedRequirementDraft {
  readonly statement: string;
  readonly type: string;
  readonly concepts: readonly string[];
  readonly actors: readonly string[];
  readonly priority?: string | undefined;
  /** Verbatim excerpt of rawText backing this requirement — mapped to offsets by the use case. */
  readonly sourceExcerpt?: string | undefined;
}

export interface ExtractedQuestionDraft {
  readonly question: string;
  readonly reason: string;
  readonly severity: string;
  readonly affectedRequirementStatements: readonly string[];
}

export interface SpecificationExtraction {
  readonly requirements: readonly ExtractedRequirementDraft[];
  readonly actors: readonly string[];
  readonly constraints: readonly string[];
  readonly openQuestions: readonly ExtractedQuestionDraft[];
}

/** Implemented by packages/ai-inference over ModelProviderPort; absent in deterministic mode. */
export interface SpecificationExtractionPort {
  extract(input: {
    readonly title: string;
    readonly rawText: string;
  }): Promise<Result<SpecificationExtraction, ModelProviderError>>;
}
