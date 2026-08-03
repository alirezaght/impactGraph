import { describe, expect, it } from 'vitest';

import { matchesGitignore, parseGitignore } from './gitignore.js';

const match = (patterns: string, path: string, isDirectory = false, baseDir = ''): boolean =>
  matchesGitignore(parseGitignore(patterns, baseDir), path, isDirectory);

describe('gitignore parsing (PRD §40.1)', () => {
  it('ignores blank lines and comments', () => {
    expect(parseGitignore('\n# a comment\n\n', '')).toEqual([]);
  });

  it('matches a bare pattern at any depth', () => {
    expect(match('*.log', 'a.log')).toBe(true);
    expect(match('*.log', 'deep/nested/a.log')).toBe(true);
    expect(match('*.log', 'a.txt')).toBe(false);
  });

  it('anchors a pattern that starts with a slash to the .gitignore directory', () => {
    expect(match('/build', 'build', true)).toBe(true);
    expect(match('/build', 'apps/build', true)).toBe(false);
  });

  it('anchors a pattern containing an interior slash', () => {
    expect(match('src/generated', 'src/generated', true)).toBe(true);
    expect(match('src/generated', 'apps/src/generated', true)).toBe(false);
  });

  it('applies a trailing-slash pattern to directories only', () => {
    expect(match('dist/', 'dist', true)).toBe(true);
    expect(match('dist/', 'dist', false)).toBe(false);
  });

  it('lets a later negation re-include an earlier match', () => {
    expect(match('*.log\n!keep.log', 'keep.log')).toBe(false);
    expect(match('*.log\n!keep.log', 'drop.log')).toBe(true);
  });

  it('lets a later pattern re-ignore a negated path (last match wins)', () => {
    expect(match('*.log\n!keep.log\nkeep.log', 'keep.log')).toBe(true);
  });

  it('resolves patterns relative to the directory the .gitignore lives in', () => {
    expect(match('*.log', 'services/api/a.log', false, 'services/api')).toBe(true);
    expect(match('*.log', 'services/other/a.log', false, 'services/api')).toBe(false);
    expect(match('/build', 'services/api/build', true, 'services/api')).toBe(true);
    expect(match('/build', 'build', true, 'services/api')).toBe(false);
  });
});
