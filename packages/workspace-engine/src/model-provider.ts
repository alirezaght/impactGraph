import { join } from 'node:path';

import {
  buildConfiguredProvider,
  createConfigTranslator,
  createFileAuditSink,
  createImpactClassifier,
  createSpecificationExtractor,
  createSpecificationInterpreter,
} from '@impactgraph/ai-inference';
import { readWorkspaceConfig } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ConfigInstructionTranslator, PromptPreview } from '@impactgraph/ai-inference';
import type {
  ImpactClassificationPort,
  SpecificationExtractionPort,
  SpecificationInterpretationPort,
} from '@impactgraph/application';

// Story 13.1 wiring: the workspace's configured provider, always behind the privacy guard,
// always audited to `.impactgraph/artifacts/ai-audit.jsonl`. Returns undefined when no
// provider strategy is configured — callers take their deterministic path (PRD §8).

export interface WorkspaceExtractorOptions {
  /** Sourced from SecretStorage (extension) or IMPACTGRAPH_API_KEY (CLI/MCP) — never files. */
  readonly apiKey?: string | undefined;
  readonly confirmSend?: ((preview: PromptPreview) => Promise<boolean>) | undefined;
}

export const auditLogPath = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts', 'ai-audit.jsonl');

export interface WorkspaceAiServices {
  readonly extractor?: SpecificationExtractionPort | undefined;
  readonly classifier?: ImpactClassificationPort | undefined;
  readonly interpreter?: SpecificationInterpretationPort | undefined;
  readonly configTranslator?: ConfigInstructionTranslator | undefined;
}

/** Both AI services over ONE guarded provider instance (same mode gate, same audit stream). */
export const createWorkspaceAiServices = (
  rootDir: string,
  options: WorkspaceExtractorOptions = {},
): Failable<WorkspaceAiServices> => {
  const config = readWorkspaceConfig(rootDir);
  if (!config.ok) {
    return failWith('configurationError', config.error.message);
  }
  const settings = config.value?.provider;
  if (settings === undefined || settings.strategy === 'none') {
    return { ok: true, value: {} };
  }
  const provider = buildConfiguredProvider({
    settings,
    privacyMode: config.value?.privacyMode ?? 'selected-snippets',
    apiKey: options.apiKey,
    audit: createFileAuditSink(auditLogPath(rootDir)),
    confirmSend: options.confirmSend,
  });
  return {
    ok: true,
    value: {
      extractor: createSpecificationExtractor(provider),
      classifier: createImpactClassifier(provider),
      interpreter: createSpecificationInterpreter(provider),
      configTranslator: createConfigTranslator(provider),
    },
  };
};

export const createWorkspaceExtractor = (
  rootDir: string,
  options: WorkspaceExtractorOptions = {},
): Failable<SpecificationExtractionPort | undefined> => {
  const services = createWorkspaceAiServices(rootDir, options);
  if (!services.ok) {
    return services;
  }
  return { ok: true, value: services.value.extractor };
};
