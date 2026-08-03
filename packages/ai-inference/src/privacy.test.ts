import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createMemoryAuditSink } from './audit.js';
import { createGuardedProvider } from './guarded-provider.js';
import { createAnthropicProvider } from './providers/anthropic.js';
import { createOpenAiCompatibleProvider } from './providers/openai-compatible.js';
import { isSecretBearingPath, redactSecrets } from './redaction.js';
import { buildConfiguredProvider } from './registry.js';
import { schemaFromZod } from './schema.js';

import type { PrivacyMode } from './guarded-provider.js';
import type { FetchLike } from './providers/http-json.js';
import type { ModelProviderPort } from '@impactgraph/application';

const testSchema = schemaFromZod('TestPayloadV1', z.object({ answer: z.string() }).strict());

const okProvider = (received: { prompt?: string; system?: string }): ModelProviderPort => ({
  id: 'fake',
  generateStructuredOutput: (request) => {
    received.prompt = request.prompt;
    received.system = request.systemPrompt ?? '';
    return Promise.resolve({
      ok: true,
      value: { output: { answer: 'ok' } as never, providerId: 'fake', modelId: 'fake-1' },
    });
  },
});

describe('redaction engine (Story 13.2, PRD §35)', () => {
  it('redacts every documented secret class, keeping key names for context', () => {
    const input = [
      'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      'github: ghp_abcdefghij1234567890abcdefghij123456',
      'anthropic sk-ant-abc123def456ghi789jkl012',
      'Authorization: Bearer abcdef1234567890abcdef1234567890',
      'postgres://user:hunter2secret@db.internal:5432/app',
      'password = "correct-horse-battery"',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow…\n-----END RSA PRIVATE KEY-----',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQs',
    ].join('\n');
    const result = redactSecrets(input);
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.text).not.toContain('hunter2secret');
    expect(result.text).not.toContain('correct-horse-battery');
    expect(result.text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(result.text).toContain('password = [REDACTED:assigned-secret]');
    expect(result.redactionCount).toBeGreaterThanOrEqual(7);
    expect(result.kinds).toContain('aws-access-key');
  });

  it('leaves ordinary code untouched', () => {
    const code = 'const total = items.filter((deal) => !deal.expired).length;';
    expect(redactSecrets(code)).toEqual({ text: code, redactionCount: 0, kinds: [] });
  });

  it('flags secret-bearing files by path', () => {
    expect(isSecretBearingPath('.env')).toBe(true);
    expect(isSecretBearingPath('config/.env.production')).toBe(true);
    expect(isSecretBearingPath('certs/server.pem')).toBe(true);
    expect(isSecretBearingPath('src/env.ts')).toBe(false);
  });
});

describe('privacy guard — the single choke point (Story 13.1/13.3, PRD §9/§40.6)', () => {
  const call = async (
    privacyMode: PrivacyMode,
    kind: 'local' | 'external',
    confirm?: boolean,
  ): Promise<{ code?: string; outcomes: string[]; sentPrompt?: string }> => {
    const received: { prompt?: string } = {};
    const audit = createMemoryAuditSink();
    const guarded = createGuardedProvider({
      inner: okProvider(received),
      kind,
      privacyMode,
      audit,
      ...(confirm === undefined ? {} : { confirmSend: () => Promise.resolve(confirm) }),
    });
    const result = await guarded.generateStructuredOutput(
      { purpose: 'test', prompt: 'analyze password = "topsecret99" now' },
      testSchema,
    );
    return {
      ...(result.ok ? {} : { code: result.error.code }),
      outcomes: audit.entries.map((entry) => entry.outcome),
      ...(received.prompt === undefined ? {} : { sentPrompt: received.prompt }),
    };
  };

  it('external-agent mode never calls any provider (§9.4)', async () => {
    const outcome = await call('external-agent', 'external');
    expect(outcome.code).toBe('blocked-by-privacy-mode');
    expect(outcome.outcomes).toEqual(['blocked']);
    expect(outcome.sentPrompt).toBeUndefined();
  });

  it('local-only blocks external providers but allows local ones (§9.1)', async () => {
    expect((await call('local-only', 'external')).code).toBe('blocked-by-privacy-mode');
    const local = await call('local-only', 'local');
    expect(local.code).toBeUndefined();
    expect(local.outcomes).toEqual(['sent']);
  });

  it('redacts secrets from every outbound prompt (§35)', async () => {
    const outcome = await call('selected-snippets', 'external');
    expect(outcome.sentPrompt).toContain('[REDACTED:assigned-secret]');
    expect(outcome.sentPrompt).not.toContain('topsecret99');
  });

  it('declined consent produces a typed error and an audit entry, and nothing is sent', async () => {
    const outcome = await call('full-context', 'external', false);
    expect(outcome.code).toBe('consent-declined');
    expect(outcome.outcomes).toEqual(['declined']);
    expect(outcome.sentPrompt).toBeUndefined();
  });

  it('audits successful sends with provider and model identity (Epic K)', async () => {
    const audit = createMemoryAuditSink();
    const guarded = createGuardedProvider({
      inner: okProvider({}),
      kind: 'external',
      privacyMode: 'selected-snippets',
      audit,
    });
    await guarded.generateStructuredOutput({ purpose: 'extraction', prompt: 'x' }, testSchema);
    expect(audit.entries[0]).toMatchObject({
      providerId: 'fake',
      modelId: 'fake-1',
      purpose: 'extraction',
      privacyMode: 'selected-snippets',
      outcome: 'sent',
    });
    // payload summary only — the entry must never carry prompt text
    expect(JSON.stringify(audit.entries[0])).not.toContain('"prompt"');
  });
});

const fetchReturning =
  (status: number, body: unknown): FetchLike =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

describe('fetch-based providers (PRD §8, ADR-0010 — no SDKs)', () => {
  it('anthropic: parses fenced JSON from a messages response and validates it', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetchImpl: fetchReturning(200, {
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Here you go:\n```json\n{"answer":"42"}\n```' }],
      }),
    });
    const result = await provider.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(result.ok && result.value.output).toEqual({ answer: '42' });
    expect(result.ok && result.value.modelId).toBe('claude-sonnet-4-5');
  });

  it('anthropic: invalid model output is a typed error, never a lenient parse (§34)', async () => {
    const provider = createAnthropicProvider({
      apiKey: 'k',
      fetchImpl: fetchReturning(200, { content: [{ type: 'text', text: '{"wrong":"shape"}' }] }),
    });
    const result = await provider.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(!result.ok && result.error.code).toBe('invalid-output');
  });

  it('maps 429 to rate-limited and network failure to provider-unavailable', async () => {
    const limited = createAnthropicProvider({ apiKey: 'k', fetchImpl: fetchReturning(429, {}) });
    const limitedResult = await limited.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(!limitedResult.ok && limitedResult.error.code).toBe('rate-limited');

    const down = createOpenAiCompatibleProvider({
      baseUrl: 'http://localhost:1',
      modelId: 'm',
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const downResult = await down.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(!downResult.ok && downResult.error.code).toBe('provider-unavailable');
  });

  it('openai-compatible: reads chat-completions content', async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'http://localhost:11434',
      modelId: 'llama3',
      fetchImpl: fetchReturning(200, {
        model: 'llama3',
        choices: [{ message: { content: '{"answer":"local"}' } }],
      }),
    });
    const result = await provider.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(result.ok && result.value.output).toEqual({ answer: 'local' });
  });
});

describe('provider registry (Story 13.1, PRD §8/§17)', () => {
  it('none/external-agent strategies yield null providers (deterministic-only)', async () => {
    for (const strategy of ['none', 'external-agent'] as const) {
      const provider = buildConfiguredProvider({
        settings: { strategy },
        privacyMode: 'selected-snippets',
      });
      const result = await provider.generateStructuredOutput(
        { purpose: 'test', prompt: 'q' },
        testSchema,
      );
      expect(!result.ok && result.error.code).toBe('not-configured');
    }
  });

  it('an external strategy without an API key degrades to the null provider — never a crash', async () => {
    const provider = buildConfiguredProvider({
      settings: { strategy: 'anthropic' },
      privacyMode: 'full-context',
    });
    const result = await provider.generateStructuredOutput(
      { purpose: 'test', prompt: 'q' },
      testSchema,
    );
    expect(!result.ok && result.error.code).toBe('not-configured');
  });
});
