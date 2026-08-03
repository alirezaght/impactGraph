import { readWorkspaceConfig, writeWorkspaceConfig } from '@impactgraph/persistence';
import * as vscode from 'vscode';

import { requireTrustedWorkspace } from '../workspace.js';

// Story 13.2 — `Configure Model Provider`. The strategy/model/baseUrl land in config.yml
// (committed, §17); the API key goes to SecretStorage ONLY (§35) — there is no code path
// that writes a key to a file.

export const API_KEY_SECRET = 'impactgraph.apiKey';

const STRATEGIES = [
  { label: 'none', description: 'deterministic-only — no AI provider (default)' },
  { label: 'anthropic', description: 'Anthropic Messages API (external; key in SecretStorage)' },
  {
    label: 'openai-compatible',
    description: 'OpenAI-compatible endpoint (external; key in SecretStorage)',
  },
  { label: 'local', description: 'local OpenAI-compatible endpoint (Ollama, llama.cpp, …)' },
  { label: 'external-agent', description: 'agent drives ImpactGraph via tools; no direct calls' },
] as const;

type Strategy = (typeof STRATEGIES)[number]['label'];

const askBaseUrl = async (strategy: Strategy): Promise<string | undefined> => {
  if (strategy === 'anthropic') {
    return '';
  }
  return vscode.window.showInputBox({
    title: 'Base URL',
    value: strategy === 'local' ? 'http://127.0.0.1:11434' : 'https://api.openai.com',
  });
};

const askDetails = async (
  strategy: Strategy,
): Promise<{ modelId?: string; baseUrl?: string } | undefined> => {
  if (strategy === 'none' || strategy === 'external-agent') {
    return {};
  }
  const modelId = await vscode.window.showInputBox({
    title: 'Model id (leave empty for the provider default)',
    placeHolder: strategy === 'anthropic' ? 'claude-sonnet-4-5' : 'llama3 / gpt-4o-mini',
  });
  if (modelId === undefined) {
    return undefined;
  }
  const baseUrl = await askBaseUrl(strategy);
  if (baseUrl === undefined) {
    return undefined;
  }
  return {
    ...(modelId.length > 0 ? { modelId } : {}),
    ...(baseUrl.length > 0 ? { baseUrl } : {}),
  };
};

const storeKeyIfExternal = async (
  context: vscode.ExtensionContext,
  strategy: Strategy,
): Promise<boolean> => {
  if (strategy !== 'anthropic' && strategy !== 'openai-compatible') {
    return true;
  }
  const key = await vscode.window.showInputBox({
    title: 'API key — stored in VS Code SecretStorage, never in files or logs (§35)',
    password: true,
  });
  if (key === undefined) {
    return false;
  }
  if (key.length > 0) {
    await context.secrets.store(API_KEY_SECRET, key);
  }
  return true;
};

export const runConfigureModelProvider = async (
  context: vscode.ExtensionContext,
): Promise<void> => {
  const root = requireTrustedWorkspace();
  if (root === undefined) {
    return;
  }
  const config = readWorkspaceConfig(root);
  if (!config.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${config.error.message}`);
    return;
  }
  const picked = await vscode.window.showQuickPick([...STRATEGIES], {
    title: 'ImpactGraph model provider (PRD §8) — every call is mode-guarded, redacted, audited',
  });
  if (picked === undefined) {
    return;
  }
  const details = await askDetails(picked.label);
  if (details === undefined) {
    return;
  }
  if (!(await storeKeyIfExternal(context, picked.label))) {
    return;
  }
  const written = writeWorkspaceConfig(root, {
    ...(config.value ?? { schemaVersion: 1 }),
    provider: { strategy: picked.label, ...details },
  });
  if (!written.ok) {
    void vscode.window.showErrorMessage(`ImpactGraph: ${written.error.message}`);
    return;
  }
  void vscode.window.showInformationMessage(
    `ImpactGraph: provider set to '${picked.label}'. Calls stay subject to the privacy mode.`,
  );
};
