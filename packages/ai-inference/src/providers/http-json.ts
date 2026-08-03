import { modelProviderError } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';

import type {
  ModelProviderError,
  ModelResponse,
  StructuredOutputSchema,
} from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

// Shared plumbing for the fetch-based providers. Deliberately SDK-free: the repo takes no
// provider SDK dependency (ADR-0010); Node's global fetch is enough for two JSON POSTs.
// Error messages carry status/category only — never prompt or response content (§35).

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpCallOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly fetchImpl: FetchLike;
}

export const postJson = async (
  options: HttpCallOptions,
): Promise<Result<unknown, ModelProviderError>> => {
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
    });
  } catch {
    return err(modelProviderError('provider-unavailable', 'provider endpoint unreachable'));
  }
  if (response.status === 429) {
    return err(modelProviderError('rate-limited', 'provider rate limit hit — retry later'));
  }
  if (!response.ok) {
    return err(
      modelProviderError('request-failed', `provider returned HTTP ${String(response.status)}`),
    );
  }
  try {
    return ok(await response.json());
  } catch {
    return err(modelProviderError('request-failed', 'provider returned non-JSON body'));
  }
};

/** Extract the first JSON object from model text (tolerates ```json fences and prose). */
export const parseModelJson = <T>(
  text: string,
  schema: StructuredOutputSchema<T>,
): T | undefined => {
  const unfenced = text.replace(/```(?:json)?/g, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    const raw: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return schema.parse(raw);
  } catch {
    return undefined;
  }
};

export const validatedResponse = <T>(
  text: string,
  schema: StructuredOutputSchema<T>,
  providerId: string,
  modelId: string,
): Result<ModelResponse<T>, ModelProviderError> => {
  const output = parseModelJson(text, schema);
  if (output === undefined) {
    // PRD §34: invalid model output is a typed error, never a lenient parse.
    return err(
      modelProviderError('invalid-output', `model output failed ${schema.name} validation`),
    );
  }
  return ok({ output, providerId, modelId });
};

export const structuredOutputInstruction = <T>(schema: StructuredOutputSchema<T>): string =>
  [
    `Respond with a single JSON object matching the ${schema.name} JSON Schema below.`,
    'No prose before or after the JSON.',
    JSON.stringify(schema.jsonSchema),
  ].join('\n');
