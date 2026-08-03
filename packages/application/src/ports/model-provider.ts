import type { Result } from '@impactgraph/domain';

// PRD §8 — the AI-agnostic provider interface. Strategies: user-configured API provider,
// local model endpoint, external agent (no direct calls), or none (deterministic-only).
// AI failure degrades features; it never breaks deterministic behavior (CLAUDE.md rule 7).

export interface ModelRequest {
  /** What this call is for (telemetry/audit label, e.g. "requirement-extraction"). */
  readonly purpose: string;
  readonly prompt: string;
  readonly systemPrompt?: string;
}

export interface ModelResponse<T> {
  readonly output: T;
  /** Provider/model metadata recorded on every AI-generated record (PRD §Z12). */
  readonly providerId: string;
  readonly modelId: string;
}

export type ModelProviderErrorCode =
  | 'not-configured'
  | 'invalid-output'
  | 'provider-unavailable'
  | 'rate-limited'
  | 'request-failed'
  /** The active privacy mode forbids this call (PRD §9, §40.6). */
  | 'blocked-by-privacy-mode'
  /** The user reviewed the prompt preview and declined the external send (§35). */
  | 'consent-declined';

export interface ModelProviderError {
  readonly name: 'ModelProviderError';
  readonly code: ModelProviderErrorCode;
  /** Never contains source code or prompt content (PRD §34, §35). */
  readonly message: string;
}

export const modelProviderError = (
  code: ModelProviderErrorCode,
  message: string,
): ModelProviderError => Object.freeze({ name: 'ModelProviderError' as const, code, message });

/**
 * The structured-output contract handed to a provider: the JSON Schema advertised to the
 * model, plus the validation gate. Providers MUST return only parse-validated output —
 * invalid model output is rejected (typed error), never passed through (PRD §34, §47.8).
 */
export interface StructuredOutputSchema<T> {
  readonly name: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  parse(raw: unknown): T | undefined;
}

export interface ModelProviderPort {
  readonly id: string;
  generateStructuredOutput<T>(
    request: ModelRequest,
    schema: StructuredOutputSchema<T>,
  ): Promise<Result<ModelResponse<T>, ModelProviderError>>;
}
