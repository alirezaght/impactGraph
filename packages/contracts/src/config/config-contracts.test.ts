import { describe, expect, it } from 'vitest';

import { aliasesConfigSchema } from './aliases-config.js';
import { architectureConfigSchema } from './architecture-config.js';
import { rulesConfigSchema } from './rules-config.js';

describe('.impactgraph/ config contracts (Story 8.1, PRD §16–17, §27)', () => {
  it('accepts the §17-style architecture.yml and round-trips it', () => {
    const document = {
      schemaVersion: 1,
      contexts: [
        { name: 'deals', description: 'Deal lifecycle', paths: ['src/deals/**'] },
        { name: 'search', paths: ['src/search/**', 'src/indexing/**'] },
      ],
      components: [
        { path: 'src/domain/**', role: 'domain' },
        { path: 'src/adapters/**', role: 'infrastructure', context: 'deals' },
      ],
    };
    const parsed = architectureConfigSchema.parse(document);
    expect(architectureConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects unknown keys, empty paths, and a missing schemaVersion', () => {
    expect(architectureConfigSchema.safeParse({ schemaVersion: 1, extra: true }).success).toBe(
      false,
    );
    expect(
      architectureConfigSchema.safeParse({
        schemaVersion: 1,
        contexts: [{ name: 'deals', paths: [] }],
      }).success,
    ).toBe(false);
    expect(architectureConfigSchema.safeParse({}).success).toBe(false);
  });

  it('accepts an aliases map and rejects blank canonical names', () => {
    const parsed = aliasesConfigSchema.parse({
      schemaVersion: 1,
      aliases: { deal: 'DealService', visibility: 'DealVisibilityPolicy' },
    });
    expect(parsed.aliases?.['deal']).toBe('DealService');
    expect(aliasesConfigSchema.safeParse({ schemaVersion: 1, aliases: { deal: '' } }).success).toBe(
      false,
    );
  });

  it('accepts both §27 rule shapes', () => {
    const parsed = rulesConfigSchema.parse({
      schemaVersion: 1,
      rules: [
        {
          id: 'no-domain-to-infra',
          type: 'dependency-direction',
          description: 'domain must not import infrastructure',
          sourceRole: 'domain',
          forbiddenTargetRole: 'infrastructure',
        },
        {
          id: 'schema-needs-migration',
          type: 'accompanying-change',
          whenChanged: 'prisma/schema.prisma',
          requireChanged: 'prisma/migrations/**',
        },
      ],
    });
    expect(parsed.rules).toHaveLength(2);
  });

  it('rejects a dependency rule without selectors on either side', () => {
    const noSource = rulesConfigSchema.safeParse({
      schemaVersion: 1,
      rules: [{ id: 'r', type: 'dependency-direction', forbiddenTargetRole: 'infrastructure' }],
    });
    expect(noSource.success).toBe(false);
    const noTarget = rulesConfigSchema.safeParse({
      schemaVersion: 1,
      rules: [{ id: 'r', type: 'dependency-direction', sourceRole: 'domain' }],
    });
    expect(noTarget.success).toBe(false);
  });

  it('rejects an unknown rule type — no silent best-effort parse', () => {
    const result = rulesConfigSchema.safeParse({
      schemaVersion: 1,
      rules: [{ id: 'r', type: 'heuristic', prompt: 'guess' }],
    });
    expect(result.success).toBe(false);
  });
});
