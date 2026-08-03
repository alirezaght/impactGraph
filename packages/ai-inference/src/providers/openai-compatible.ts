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

// Chat-completions-compatible endpoints (OpenAI, Ollama, llama.cpp, vLLM, …) over plain
// fetch. This is also the "local model" strategy of PRD §9.1: pointed at localhost it
// satisfies local-only mode (the registry marks it `kind: 'local'`).

export interface OpenAiCompatibleProviderOptions {
  readonly id?: string | undefined;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey?: string | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}

interface ChatCompletionsResponse {
  readonly choices?: readonly { message?: { content?: string } }[];
  readonly model?: string;
}

class OpenAiCompatibleProvider implements ModelProviderPort {
  public readonly id: string;
  private readonly options: OpenAiCompatibleProviderOptions;

  public constructor(options: OpenAiCompatibleProviderOptions) {
    this.options = options;
    this.id = options.id ?? 'openai-compatible';
  }

  public async generateStructuredOutput<T>(
    request: ModelRequest,
    schema: StructuredOutputSchema<T>,
  ): Promise<Result<ModelResponse<T>, ModelProviderError>> {
    const response = await postJson({
      url: `${this.options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`,
      headers:
        this.options.apiKey === undefined ? {} : { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: this.options.modelId,
        messages: [
          {
            role: 'system',
            content: [request.systemPrompt, structuredOutputInstruction(schema)]
              .filter((part): part is string => part !== undefined)
              .join('\n\n'),
          },
          { role: 'user', content: request.prompt },
        ],
      },
      fetchImpl: this.options.fetchImpl ?? fetch,
    });
    if (!response.ok) {
      return response;
    }
    const body = response.value as ChatCompletionsResponse;
    const text = body.choices?.[0]?.message?.content ?? '';
    return validatedResponse(text, schema, this.id, body.model ?? this.options.modelId);
  }
}

export const createOpenAiCompatibleProvider = (
  options: OpenAiCompatibleProviderOptions,
): ModelProviderPort => new OpenAiCompatibleProvider(options);
