import { modelProviderError } from '@impactgraph/application';
import { err } from '@impactgraph/domain';

import { redactSecrets } from './redaction.js';

import type { AuditEntry, AuditSink } from './audit.js';
import type { RedactionResult } from './redaction.js';
import type {
  ModelProviderError,
  ModelProviderPort,
  ModelRequest,
  ModelResponse,
  StructuredOutputSchema,
} from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';

// Story 13.1/13.3 — THE single choke point for every model call (PRD §9, §35, §40.6).
// Mode enforcement, secret redaction, user consent, and audit all happen here; no provider
// is ever invoked except through this wrapper.

export type PrivacyMode = 'local-only' | 'selected-snippets' | 'full-context' | 'external-agent';

export type ProviderKind = 'local' | 'external';

/** What the user may inspect before an external send — already redacted (§35). */
export interface PromptPreview {
  readonly providerId: string;
  readonly purpose: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly redactionCount: number;
}

export interface GuardedProviderOptions {
  readonly inner: ModelProviderPort;
  readonly kind: ProviderKind;
  readonly privacyMode: PrivacyMode;
  readonly audit?: AuditSink | undefined;
  /** Consent hook for external sends; absent = proceed (headless CLI documents this). */
  readonly confirmSend?: ((preview: PromptPreview) => Promise<boolean>) | undefined;
}

const blockedReason = (mode: PrivacyMode, kind: ProviderKind): string | undefined => {
  if (mode === 'external-agent') {
    return 'external-agent mode: ImpactGraph makes no direct model calls (§9.4)';
  }
  if (mode === 'local-only' && kind === 'external') {
    return 'local-only mode blocks external providers (§9.1)';
  }
  return undefined;
};

interface GuardedCall {
  readonly purpose: string;
  readonly hasSystemPrompt: boolean;
  readonly prompt: RedactionResult;
  readonly systemPrompt: RedactionResult;
}

class GuardedProvider implements ModelProviderPort {
  public readonly id: string;
  private readonly options: GuardedProviderOptions;

  public constructor(options: GuardedProviderOptions) {
    this.options = options;
    this.id = options.inner.id;
  }

  public async generateStructuredOutput<T>(
    request: ModelRequest,
    schema: StructuredOutputSchema<T>,
  ): Promise<Result<ModelResponse<T>, ModelProviderError>> {
    const { inner, kind, privacyMode, audit } = this.options;
    const guarded: GuardedCall = {
      purpose: request.purpose,
      hasSystemPrompt: request.systemPrompt !== undefined,
      prompt: redactSecrets(request.prompt),
      systemPrompt: redactSecrets(request.systemPrompt ?? ''),
    };
    const entry = {
      timestamp: new Date().toISOString(),
      providerId: inner.id,
      purpose: request.purpose,
      privacyMode,
      promptChars: guarded.prompt.text.length + guarded.systemPrompt.text.length,
      redactionCount: guarded.prompt.redactionCount + guarded.systemPrompt.redactionCount,
    };

    const blocked = blockedReason(privacyMode, kind);
    if (blocked !== undefined) {
      audit?.record({ ...entry, outcome: 'blocked', detail: blocked });
      return err(modelProviderError('blocked-by-privacy-mode', blocked));
    }
    if (!(await this.consented(guarded, entry.redactionCount))) {
      audit?.record({ ...entry, outcome: 'declined' });
      return err(modelProviderError('consent-declined', 'user declined the external send'));
    }
    return this.send(guarded, schema, entry);
  }

  private async consented(call: GuardedCall, redactionCount: number): Promise<boolean> {
    const { inner, kind, confirmSend } = this.options;
    if (kind !== 'external' || confirmSend === undefined) {
      return true;
    }
    return confirmSend({
      providerId: inner.id,
      purpose: call.purpose,
      systemPrompt: call.systemPrompt.text,
      prompt: call.prompt.text,
      redactionCount,
    });
  }

  private async send<T>(
    call: GuardedCall,
    schema: StructuredOutputSchema<T>,
    entry: Omit<AuditEntry, 'outcome' | 'modelId' | 'detail'>,
  ): Promise<Result<ModelResponse<T>, ModelProviderError>> {
    const { inner, audit } = this.options;
    const result = await inner.generateStructuredOutput<T>(
      {
        purpose: call.purpose,
        prompt: call.prompt.text,
        ...(call.hasSystemPrompt ? { systemPrompt: call.systemPrompt.text } : {}),
      },
      schema,
    );
    if (result.ok) {
      audit?.record({ ...entry, outcome: 'sent', modelId: result.value.modelId });
    } else {
      audit?.record({
        ...entry,
        outcome: result.error.code === 'invalid-output' ? 'invalid-output' : 'failed',
        detail: result.error.code,
      });
    }
    return result;
  }
}

export const createGuardedProvider = (options: GuardedProviderOptions): ModelProviderPort =>
  new GuardedProvider(options);
