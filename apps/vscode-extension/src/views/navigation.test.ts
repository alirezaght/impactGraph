import { describe, expect, it } from 'vitest';

import { accessibilityLabel, resolveSourcePath, toEditorSelection } from './navigation.js';

describe('node → source resolution (Story 7.5, §18.4/§40.4)', () => {
  it('joins workspace-relative paths onto the workspace root', () => {
    expect(resolveSourcePath('/repo', 'src/services/deal-service.ts')).toBe(
      '/repo/src/services/deal-service.ts',
    );
  });

  it('keeps absolute paths untouched', () => {
    expect(resolveSourcePath('/repo', '/elsewhere/file.ts')).toBe('/elsewhere/file.ts');
  });

  it('is not navigable without a workspace root or a path', () => {
    expect(resolveSourcePath(undefined, 'src/a.ts')).toBeUndefined();
    expect(resolveSourcePath('/repo', undefined)).toBeUndefined();
    expect(resolveSourcePath('/repo', '')).toBeUndefined();
  });

  it('rejects non-file evidence labels such as commit references', () => {
    expect(resolveSourcePath('/repo', 'commit abc1234')).toBeUndefined();
  });
});

describe('accessibility labels (§37)', () => {
  it('announces the description badge alongside the label', () => {
    expect(accessibilityLabel('DealService', 'required · business-rule · 0.90')).toBe(
      'DealService, required · business-rule · 0.90',
    );
  });

  it('falls back to the bare label when there is no description', () => {
    expect(accessibilityLabel('DealService')).toBe('DealService');
    expect(accessibilityLabel('DealService', '')).toBe('DealService');
  });

  describe('toEditorSelection (§40.4)', () => {
    it('converts a 1-based declaration range to a 0-based editor selection', () => {
      expect(
        toEditorSelection({ startLine: 12, startColumn: 3, endLine: 20, endColumn: 1 }),
      ).toEqual({ startLine: 11, startColumn: 2, endLine: 19, endColumn: 0 });
    });

    it('returns undefined for a missing or degenerate range — open at the top instead', () => {
      expect(toEditorSelection(undefined)).toBeUndefined();
      // line 0 means "no position recorded"; revealing line -1 would be worse than nothing
      expect(
        toEditorSelection({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }),
      ).toBeUndefined();
    });

    it('clamps an end before its start to a single-line selection', () => {
      expect(toEditorSelection({ startLine: 9, startColumn: 1, endLine: 4, endColumn: 2 })).toEqual(
        {
          startLine: 8,
          startColumn: 0,
          endLine: 8,
          endColumn: 1,
        },
      );
    });
  });
});
