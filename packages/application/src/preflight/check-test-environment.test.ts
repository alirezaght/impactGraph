import { describe, expect, it } from 'vitest';

import { checkTestEnvironment, detectSqlDialect } from './check-test-environment.js';

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`;

const SQLITE_ENV = {
  engine: 'sqlite' as const,
  filePath: 'services/newsletter-service/tests/conftest.py',
  evidenceIds: ['ev-test-env'],
};

describe('detectSqlDialect', () => {
  it('recognizes Postgres-specific constructs', () => {
    expect(detectSqlDialect('INSERT … ON CONFLICT (id) DO NOTHING')?.engine).toBe('postgres');
    expect(detectSqlDialect('SELECT gen_random_uuid()')?.engine).toBe('postgres');
    expect(detectSqlDialect('WHERE id = :id::uuid')?.engine).toBe('postgres');
    expect(detectSqlDialect('WHERE title ILIKE :q')?.engine).toBe('postgres');
  });

  it('claims nothing about portable SQL', () => {
    expect(detectSqlDialect('SELECT * FROM listings WHERE id = :id')).toBeUndefined();
  });
});

describe('checkTestEnvironment', () => {
  it('warns when the plan uses Postgres-specific SQL and the tests run on SQLite', () => {
    const findings = checkTestEnvironment({
      specificationText:
        'Deduplicate sends with INSERT INTO sends (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING.',
      testEnvironments: [SQLITE_ENV],
      requirementIds: ['R5'],
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('constraint-warning');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.statement).toContain('ON CONFLICT');
    expect(findings[0]?.statement).toContain('sqlite');
    expect(findings[0]?.statement).toContain('conftest.py');
  });

  it('stays silent when a test environment runs the same engine', () => {
    const findings = checkTestEnvironment({
      specificationText: 'Use ON CONFLICT DO NOTHING for idempotency.',
      testEnvironments: [
        SQLITE_ENV,
        { engine: 'postgres', filePath: 'docker-compose.test.yml', evidenceIds: [] },
      ],
      requirementIds: ['R5'],
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('stays silent when nothing states the test environment — absence is not evidence', () => {
    const findings = checkTestEnvironment({
      specificationText: 'Use ON CONFLICT DO NOTHING for idempotency.',
      testEnvironments: [],
      requirementIds: ['R5'],
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('stays silent for portable SQL', () => {
    const findings = checkTestEnvironment({
      specificationText: 'SELECT * FROM sends WHERE id = :id.',
      testEnvironments: [SQLITE_ENV],
      requirementIds: ['R5'],
      nextId,
    });
    expect(findings).toEqual([]);
  });
});
