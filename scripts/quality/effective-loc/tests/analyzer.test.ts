import { describe, expect, it } from 'vitest';

import { analyzeEffectiveLoc, defaultRegistry } from '../src/analyzer.js';

import type { LineKind } from '../src/analyzer.js';

const src = (...lines: string[]): string => `${lines.join('\n')}\n`;

function kinds(fileName: string, sourceText: string): LineKind[] {
  return analyzeEffectiveLoc(fileName, sourceText).lines.map((line) => line.kind);
}

describe('analyzeEffectiveLoc', () => {
  it('returns zero for an empty file', () => {
    const result = analyzeEffectiveLoc('empty.ts', '');
    expect(result.effectiveLines).toBe(0);
    expect(result.totalLines).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('treats a whitespace-only file as blank', () => {
    const result = analyzeEffectiveLoc('blank.ts', '   \n');
    expect(result.effectiveLines).toBe(0);
    expect(result.totalLines).toBe(1);
    expect(result.lines[0]?.kind).toBe('blank');
  });

  it('excludes blank lines and line/block/JSDoc comments', () => {
    const text = src(
      'const a = 1;',
      '',
      '// line comment',
      '/* block comment */',
      '/**',
      ' * JSDoc for b',
      ' */',
      'const b = a + 1;',
    );
    const result = analyzeEffectiveLoc('comments.ts', text);
    expect(result.totalLines).toBe(8);
    expect(result.effectiveLines).toBe(2);
    expect(kinds('comments.ts', text)).toEqual([
      'code',
      'blank',
      'comment',
      'comment',
      'comment',
      'comment',
      'comment',
      'code',
    ]);
  });

  it('excludes every line of a multi-line import', () => {
    const text = src(
      'import {',
      '  join,',
      '  resolve,',
      "} from 'node:path';",
      '',
      "export const p = join(resolve('.'), 'src');",
    );
    const result = analyzeEffectiveLoc('imports.ts', text);
    expect(result.effectiveLines).toBe(1);
    expect(kinds('imports.ts', text)).toEqual([
      'import',
      'import',
      'import',
      'import',
      'blank',
      'code',
    ]);
  });

  it('excludes type-only and star re-exports but counts value re-exports', () => {
    const text = src(
      "export type { LineKind } from './analyzer.js';",
      "export * from './analyzer.js';",
      "export { type EffectiveLocResult } from './analyzer.js';",
      "export { analyzeEffectiveLoc } from './analyzer.js';",
    );
    const result = analyzeEffectiveLoc('reexports.ts', text);
    expect(result.effectiveLines).toBe(1);
    expect(kinds('reexports.ts', text)).toEqual(['re-export', 're-export', 're-export', 'code']);
  });

  it('excludes lines whose only tokens are punctuation', () => {
    const text = src(
      'const config = {',
      "  name: 'impactgraph',",
      '};',
      'const list = [',
      '  1,',
      '];',
    );
    const result = analyzeEffectiveLoc('punctuation.ts', text);
    expect(result.effectiveLines).toBe(4);
    expect(kinds('punctuation.ts', text)).toEqual([
      'code',
      'code',
      'punctuation-only',
      'code',
      'code',
      'punctuation-only',
    ]);
  });

  it('counts a line mixing code and a trailing comment', () => {
    const result = analyzeEffectiveLoc('mixed.ts', src('const answer = 42; // the answer'));
    expect(result.effectiveLines).toBe(1);
    expect(result.lines[0]?.kind).toBe('code');
  });

  it('counts template-literal lines containing comment markers', () => {
    const text = src(
      'export const t = `',
      '// not a comment inside a template',
      '/* also not a comment */',
      '`;',
      'export const n = t.length;',
    );
    const result = analyzeEffectiveLoc('template.ts', text);
    expect(result.effectiveLines).toBe(5);
    expect(kinds('template.ts', text)).toEqual(['code', 'code', 'code', 'code', 'code']);
  });

  it('counts strings containing comment markers', () => {
    const result = analyzeEffectiveLoc(
      'strings.ts',
      src('const s = "/* not a comment */ // still a string";'),
    );
    expect(result.effectiveLines).toBe(1);
  });

  it('handles TSX: JSX text counts, JSX comment containers do not', () => {
    const text = src(
      'export function App(): unknown {',
      '  return (',
      '    <main title="impact-graph">',
      '      {/* JSX comment container: braces only */}',
      '      Plain JSX text',
      '      <br />',
      '    </main>',
      '  );',
      '}',
    );
    const result = analyzeEffectiveLoc('component.tsx', text);
    expect(result.effectiveLines).toBe(6);
    expect(kinds('component.tsx', text)).toEqual([
      'code',
      'code',
      'code',
      'punctuation-only',
      'code',
      'code',
      'code',
      'punctuation-only',
      'punctuation-only',
    ]);
  });

  it('counts decorator lines', () => {
    const text = src(
      '@sealed',
      'class ReportJob {',
      '  @logged',
      '  run(): number {',
      '    return 1;',
      '  }',
      '}',
    );
    const result = analyzeEffectiveLoc('decorators.ts', text);
    expect(result.effectiveLines).toBe(5);
    expect(result.lines[0]?.kind).toBe('code');
    expect(result.lines[2]?.kind).toBe('code');
  });

  it('excludes the shebang line', () => {
    const text = src('#!/usr/bin/env node', "process.stdout.write('impactgraph');");
    const result = analyzeEffectiveLoc('bin.ts', text);
    expect(result.effectiveLines).toBe(1);
    expect(result.lines[0]?.kind).toBe('shebang');
    expect(result.lines[1]?.kind).toBe('code');
  });

  it('handles a file without a trailing newline', () => {
    const result = analyzeEffectiveLoc('no-newline.ts', 'const x = 1;');
    expect(result.totalLines).toBe(1);
    expect(result.effectiveLines).toBe(1);
  });
});

describe('defaultRegistry', () => {
  it('supports the TypeScript family and rejects other languages', () => {
    for (const file of ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mts', 'f.cjs']) {
      expect(defaultRegistry.find(file)?.id).toBe('typescript');
    }
    expect(defaultRegistry.find('script.py')).toBeUndefined();
    expect(defaultRegistry.find('Main.java')).toBeUndefined();
  });
});
