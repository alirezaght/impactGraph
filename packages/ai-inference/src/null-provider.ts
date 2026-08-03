import { modelProviderError } from '@impactgraph/application';
import { err } from '@impactgraph/domain';

import type { ModelProviderPort, ModelResponse } from '@impactgraph/application';
import type { ModelProviderError } from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

/**
 * The "no AI provider" strategy (PRD §8): every call reports not-configured so callers take
 * their deterministic path. Also used for the external-agent strategy, where the agent drives
 * ImpactGraph through tools and ImpactGraph itself makes no direct model calls.
 */
class NullProvider implements ModelProviderPort {
  public readonly id: string;
  private readonly reason: string;

  public constructor(id: string, reason: string) {
    this.id = id;
    this.reason = reason;
  }

  public generateStructuredOutput<T>(): Promise<Result<ModelResponse<T>, ModelProviderError>> {
    return Promise.resolve(err(modelProviderError('not-configured', this.reason)));
  }
}

export type ProviderStrategy = 'none' | 'external-agent';

export const createNullProvider = (strategy: ProviderStrategy = 'none'): ModelProviderPort =>
  strategy === 'external-agent'
    ? new NullProvider(
        'external-agent',
        'external agent drives ImpactGraph via tools — no direct model calls',
      )
    : new NullProvider('none', 'no AI provider configured — deterministic-only mode');
