// @impactgraph/ai-inference — ModelProvider implementations and prompt contracts (ADR-0010).
// Provider SDKs may only ever be imported under src/providers/ (the fetch-based providers
// deliberately use none). Every configured provider is wrapped in the privacy guard.

export { schemaFromZod } from './schema.js';
export { createNullProvider } from './null-provider.js';
export type { ProviderStrategy } from './null-provider.js';
export { createSpecificationExtractor } from './specification-extractor.js';
export { createImpactClassifier } from './impact-classifier.js';
export { createSpecificationInterpreter } from './specification-interpreter.js';
export { createConfigTranslator } from './config-translator.js';
export type { ConfigInstructionTranslator } from './config-translator.js';
export { redactSecrets, isSecretBearingPath } from './redaction.js';
export type { RedactionResult } from './redaction.js';
export { createFileAuditSink, createMemoryAuditSink } from './audit.js';
export type { AuditEntry, AuditSink } from './audit.js';
export { createGuardedProvider } from './guarded-provider.js';
export type {
  GuardedProviderOptions,
  PrivacyMode,
  PromptPreview,
  ProviderKind,
} from './guarded-provider.js';
export { createAnthropicProvider } from './providers/anthropic.js';
export type { AnthropicProviderOptions } from './providers/anthropic.js';
export { createOpenAiCompatibleProvider } from './providers/openai-compatible.js';
export type { OpenAiCompatibleProviderOptions } from './providers/openai-compatible.js';
export { buildConfiguredProvider } from './registry.js';
export type { ProviderSettings, BuildProviderOptions } from './registry.js';
export { buildPromptSnippets } from './snippets.js';
export type { SnippetSource, PromptSnippet, SnippetBuildResult } from './snippets.js';
