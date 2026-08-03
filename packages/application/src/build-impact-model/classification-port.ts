import type { ModelProviderError } from '../ports/model-provider.js';
import type { Result } from '@impactgraph/domain';

// The port contract for the LLM classification pass (PRD §43.5): the model re-classifies a
// BOUNDED candidate set — it never lists components freehand. Implemented by
// packages/ai-inference; absent in deterministic-only mode.

/** A candidate summary — the minimized context sent for classification (PRD §9.2). */
export interface ClassificationCandidate {
  readonly nodeId: string;
  readonly name: string;
  readonly nodeType: string;
  readonly category: string;
  readonly distance: number;
  /** Human-readable dependency path, e.g. "DealService → deal-updated → DealSearchIndexer". */
  readonly path: string;
}

export interface ClassificationRequest {
  readonly requirementId: string;
  readonly requirementStatement: string;
  readonly candidates: readonly ClassificationCandidate[];
}

/** One re-classification. Strings are model text: rendered, never interpreted. */
export interface ImpactClassification {
  readonly nodeId: string;
  readonly likelihood: string;
  readonly impactType: string;
  readonly explanation: string;
  readonly expectedChanges: readonly string[];
}

export interface ImpactClassificationPort {
  classify(
    request: ClassificationRequest,
  ): Promise<Result<readonly ImpactClassification[], ModelProviderError>>;
}
