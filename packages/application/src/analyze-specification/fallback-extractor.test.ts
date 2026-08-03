import { describe, expect, it } from 'vitest';

import { fallbackExtraction } from './fallback-extractor.js';

const statements = (rawText: string): string[] =>
  fallbackExtraction(rawText).requirements.map((requirement) => requirement.statement);

describe('fallbackExtraction segmentation', () => {
  it('joins hard-wrapped lines into whole sentences', () => {
    const spec = [
      '# Extension packaging',
      '',
      'The packaged `.vsix` must contain the `better-sqlite3` native binding so the installed',
      'extension can open its SQLite index. `openSqliteIndexStore` currently fails in an installed',
      'extension because the binding is external to the esbuild bundle and lives in `node_modules`,',
      'which packaging excludes.',
    ].join('\n');

    expect(statements(spec)).toEqual([
      'The packaged `.vsix` must contain the `better-sqlite3` native binding so the installed extension can open its SQLite index.',
      '`openSqliteIndexStore` currently fails in an installed extension because the binding is external to the esbuild bundle and lives in `node_modules`, which packaging excludes.',
    ]);
  });

  it('separates paragraphs at blank lines and headings', () => {
    const spec = [
      '## Packaging',
      'The bundle must exclude sourcemaps.',
      '',
      '## Key entry',
      'The key must live in SecretStorage only.',
    ].join('\n');

    expect(statements(spec)).toEqual([
      'The bundle must exclude sourcemaps.',
      'The key must live in SecretStorage only.',
    ]);
  });

  it('keeps each bullet a separate requirement and joins its continuation lines', () => {
    const spec = [
      '- The extension must ship the native binding so the index opens',
      '  on a clean install.',
      '- The packaged archive must exclude test bundles.',
    ].join('\n');

    expect(statements(spec)).toEqual([
      'The extension must ship the native binding so the index opens on a clean install.',
      'The packaged archive must exclude test bundles.',
    ]);
  });

  it('does not split on abbreviations or version dots mid-sentence', () => {
    const spec = 'The loader must resolve node.js addons, e.g. the better-sqlite3 binding.';

    expect(statements(spec)).toEqual([
      'The loader must resolve node.js addons, e.g. the better-sqlite3 binding.',
    ]);
  });

  it('still carries priority and concepts through the joined statement', () => {
    const spec = ['`configureModelProvider` must open the console page before', 'prompting.'].join(
      '\n',
    );
    const [requirement] = fallbackExtraction(spec).requirements;

    expect(requirement?.statement).toBe(
      '`configureModelProvider` must open the console page before prompting.',
    );
    expect(requirement?.priority).toBe('must');
    expect(requirement?.concepts).toContain('configureModelProvider');
  });
});
