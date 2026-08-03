import { modelProviderError } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';

import type {
  ModelProviderError,
  ModelProviderPort,
  ModelRequest,
  ModelResponse,
  StructuredOutputSchema,
} from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

export interface FakeModelProvider extends ModelProviderPort {
  readonly requests: ModelRequest[];
}

/**
 * Test fake: returns queued raw outputs in order. Each output still passes through the
 * schema's parse gate, so tests exercise the real invalid-output rejection path.
 */
export const createFakeModelProvider = (queuedOutputs: readonly unknown[]): FakeModelProvider => {
  const queue = [...queuedOutputs];
  const requests: ModelRequest[] = [];
  return {
    id: 'fake',
    requests,
    generateStructuredOutput: <T>(
      request: ModelRequest,
      schema: StructuredOutputSchema<T>,
    ): Promise<Result<ModelResponse<T>, ModelProviderError>> => {
      requests.push(request);
      if (queue.length === 0) {
        return Promise.resolve(err(modelProviderError('provider-unavailable', 'queue empty')));
      }
      const raw = queue.shift();
      const output = schema.parse(raw);
      if (output === undefined) {
        return Promise.resolve(
          err(modelProviderError('invalid-output', `output failed ${schema.name} validation`)),
        );
      }
      return Promise.resolve(ok({ output, providerId: 'fake', modelId: 'fake-model' }));
    },
  };
};
