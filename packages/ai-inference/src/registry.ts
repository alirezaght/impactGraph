import { createGuardedProvider } from './guarded-provider.js';
import { createNullProvider } from './null-provider.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOpenAiCompatibleProvider } from './providers/openai-compatible.js';

import type { AuditSink } from './audit.js';
import type { PrivacyMode, PromptPreview } from './guarded-provider.js';
import type { ModelProviderPort } from '@impactgraph/application';

// Story 13.1 — provider selection (PRD §8/§9 strategies). Configuration carries strategy,
// model id, and base URL only; the API key is sourced by the caller (SecretStorage in the
// extension, IMPACTGRAPH_API_KEY in the CLI/MCP) and NEVER lives in a file (§35).

export interface ProviderSettings {
  readonly strategy: 'none' | 'external-agent' | 'anthropic' | 'openai-compatible' | 'local';
  readonly modelId?: string | undefined;
  readonly baseUrl?: string | undefined;
}

export interface BuildProviderOptions {
  readonly settings: ProviderSettings;
  readonly privacyMode: PrivacyMode;
  readonly apiKey?: string | undefined;
  readonly audit?: AuditSink | undefined;
  readonly confirmSend?: ((preview: PromptPreview) => Promise<boolean>) | undefined;
}

const externalInner = (settings: ProviderSettings, apiKey: string): ModelProviderPort =>
  settings.strategy === 'anthropic'
    ? createAnthropicProvider({ apiKey, modelId: settings.modelId, baseUrl: settings.baseUrl })
    : createOpenAiCompatibleProvider({
        baseUrl: settings.baseUrl ?? 'https://api.openai.com',
        modelId: settings.modelId ?? 'gpt-4o-mini',
        apiKey,
      });

/** Every non-null provider comes back wrapped in the privacy guard — no other path exists. */
export const buildConfiguredProvider = (options: BuildProviderOptions): ModelProviderPort => {
  const { settings, privacyMode, apiKey, audit, confirmSend } = options;
  if (settings.strategy === 'none' || settings.strategy === 'external-agent') {
    return createNullProvider(settings.strategy === 'none' ? 'none' : 'external-agent');
  }
  if (settings.strategy === 'local') {
    return createGuardedProvider({
      inner: createOpenAiCompatibleProvider({
        id: 'local-model',
        baseUrl: settings.baseUrl ?? 'http://127.0.0.1:11434',
        modelId: settings.modelId ?? 'llama3',
      }),
      kind: 'local',
      privacyMode,
      audit,
      confirmSend,
    });
  }
  if (apiKey === undefined || apiKey.length === 0) {
    return createNullProvider('none');
  }
  return createGuardedProvider({
    inner: externalInner(settings, apiKey),
    kind: 'external',
    privacyMode,
    audit,
    confirmSend,
  });
};
