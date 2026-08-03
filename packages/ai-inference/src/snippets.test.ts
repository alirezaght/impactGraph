import { describe, expect, it } from 'vitest';

import { buildPromptSnippets } from './snippets.js';

import type { SnippetSource } from './snippets.js';

const source = (overrides: Partial<SnippetSource> = {}): SnippetSource => ({
  filePath: 'src/deal-service.ts',
  symbolName: 'DealService',
  signature: 'export class DealService {',
  fullText: 'export class DealService {\n  private readonly secretSauce = 42;\n}',
  ...overrides,
});

describe('snippet minimization (Story 13.2, §9.2)', () => {
  it('local-only and external-agent produce NOTHING — no repository content leaves', () => {
    for (const mode of ['local-only', 'external-agent'] as const) {
      const result = buildPromptSnippets(mode, [source()]);
      expect(result.snippets).toEqual([]);
      expect(result.excludedPaths).toEqual(['src/deal-service.ts']);
    }
  });

  it('selected-snippets sends symbols, signatures, and selections — never file bodies', () => {
    const result = buildPromptSnippets('selected-snippets', [
      source({ selectedText: 'const visible = filterExpired(deals);' }),
    ]);
    const content = result.snippets[0]?.content ?? '';
    expect(content).toContain('symbol: DealService');
    expect(content).toContain('export class DealService {');
    expect(content).toContain('filterExpired(deals)');
    expect(content).not.toContain('secretSauce'); // fullText body excluded in this mode
  });

  it('full-context may include file text — still redacted and capped', () => {
    const result = buildPromptSnippets('full-context', [
      source({ fullText: 'const apiKey = "sk-ant-abcdefghijklmnopqrstuvwx";' }),
    ]);
    const content = result.snippets[0]?.content ?? '';
    expect(content).toContain('[REDACTED:');
    expect(content).not.toContain('sk-ant-abcdefghijklmnop');
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  it('secret-bearing files are excluded wholesale in every sending mode (§35)', () => {
    for (const mode of ['selected-snippets', 'full-context'] as const) {
      const result = buildPromptSnippets(mode, [
        source({ filePath: '.env', fullText: 'DB_PASSWORD=hunter2' }),
        source({ filePath: 'secrets/service-account.json' }),
      ]);
      expect(result.snippets).toEqual([]);
      expect(result.excludedPaths).toEqual(['.env', 'secrets/service-account.json']);
    }
  });

  it('.tfvars content never leaves, even though the file IS indexed for CONFIGURES edges', () => {
    const result = buildPromptSnippets('full-context', [
      source({ filePath: 'infra/terraform.tfvars', fullText: 'db_password = "hunter2"' }),
      source({ filePath: 'infra/prod.auto.tfvars', fullText: 'api_key = "sk-live"' }),
      source({ filePath: 'infra/vars.tfvars.json', fullText: '{"token":"abc"}' }),
    ]);
    expect(result.snippets).toEqual([]);
    expect(result.excludedPaths).toHaveLength(3);
  });

  it('oversized content is truncated per snippet and the total budget stops later files', () => {
    const big = 'x'.repeat(3_000);
    const many = Array.from({ length: 15 }, (_, i) =>
      source({ filePath: `src/f${String(i)}.ts`, signature: big }),
    );
    const result = buildPromptSnippets('selected-snippets', many);
    expect(result.snippets[0]?.truncated).toBe(true);
    expect(result.snippets[0]?.content.length).toBeLessThanOrEqual(2_100);
    expect(result.snippets.length).toBeLessThan(many.length); // budget exhausted
    expect(result.excludedPaths.length).toBeGreaterThan(0);
  });

  it('sources with nothing allowed in the mode are excluded, not sent empty', () => {
    const result = buildPromptSnippets('selected-snippets', [
      { filePath: 'src/opaque.bin', fullText: 'raw bytes only' },
    ]);
    expect(result.snippets).toEqual([]);
    expect(result.excludedPaths).toEqual(['src/opaque.bin']);
  });
});
