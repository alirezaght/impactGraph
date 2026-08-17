import type { ModelProviderError } from '../ports/model-provider.js';
import type {
  ExtractionQuality,
  RequirementOrigin,
  Result,
  SpecNoteKind,
} from '@impactgraph/domain';

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
  /** Where the statement came from. Absent → treated as `prose-fallback`, the weakest reading. */
  readonly origin?: RequirementOrigin | undefined;
  /** Author-assigned identifier, when the specification declared one. */
  readonly label?: string | undefined;
  /**
   * How confident the extractor is that this statement is a requirement at all, in [0, 1]. Set
   * where admission was the extractor's decision (prose origins); out-of-range values are dropped
   * by the use case, never clamped into a stronger claim.
   */
  readonly extractionConfidence?: number | undefined;
  /** Heading the statement was found under, verbatim. */
  readonly heading?: string | undefined;
}

/** Specification prose that is explicitly NOT a requirement (context, non-goal, ambiguous, …). */
export interface ExtractedNoteDraft {
  readonly statement: string;
  readonly kind: SpecNoteKind;
  readonly heading?: string | undefined;
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
  /**
   * Non-requirement statements. Optional so a provider that does not yet produce them is not
   * forced to claim the specification had none — the use case then records no notes rather than
   * asserting an empty set.
   */
  readonly notes?: readonly ExtractedNoteDraft[] | undefined;
  /**
   * How the requirements were obtained. Optional for the same reason; when a provider omits it,
   * the use case derives a conservative quality report from the drafts' origins instead.
   */
  readonly quality?: ExtractionQuality | undefined;
}

/** Implemented by packages/ai-inference over ModelProviderPort; absent in deterministic mode. */
export interface SpecificationExtractionPort {
  extract(input: {
    readonly title: string;
    readonly rawText: string;
  }): Promise<Result<SpecificationExtraction, ModelProviderError>>;
}
