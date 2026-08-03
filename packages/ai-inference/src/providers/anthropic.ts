import { postJson, structuredOutputInstruction, validatedResponse } from './http-json.js';

import type { FetchLike } from './http-json.js';
import type {
  ModelProviderError,
  ModelProviderPort,
  ModelRequest,
  ModelResponse,
  StructuredOutputSchema,
} from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

// Anthropic Messages API over plain fetch (no SDK, ADR-0010). API keys arrive per call
// options only — never from config files (§35); callers source them from SecretStorage or
// the environment. All calls reach this provider through the privacy guard.

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly modelId?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}

const DEFAULT_MODEL = 'claude-sonnet-4-5';

interface MessagesResponse {
  readonly content?: readonly { type?: string; text?: string }[];
  readonly model?: string;
}

class AnthropicProvider implements ModelProviderPort {
  public readonly id = 'anthropic';
  private readonly options: AnthropicProviderOptions;

  public constructor(options: AnthropicProviderOptions) {
    this.options = options;
  }

  public async generateStructuredOutput<T>(
    request: ModelRequest,
    schema: StructuredOutputSchema<T>,
  ): Promise<Result<ModelResponse<T>, ModelProviderError>> {
    const modelId = this.options.modelId ?? DEFAULT_MODEL;
    const response = await postJson({
      url: `${this.options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      headers: {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: modelId,
        max_tokens: 4096,
        system: [request.systemPrompt, structuredOutputInstruction(schema)]
          .filter((part): part is string => part !== undefined)
          .join('\n\n'),
        messages: [{ role: 'user', content: request.prompt }],
      },
      fetchImpl: this.options.fetchImpl ?? fetch,
    });
    if (!response.ok) {
      return response;
    }
    const body = response.value as MessagesResponse;
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text ?? '')
      .join('\n');
    return validatedResponse(text, schema, this.id, body.model ?? modelId);
  }
}

export const createAnthropicProvider = (options: AnthropicProviderOptions): ModelProviderPort =>
  new AnthropicProvider(options);
