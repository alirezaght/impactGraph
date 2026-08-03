import { describe, expect, it } from 'vitest';

import {
  assignToContextOperation,
  contextPickItems,
  correctionAppliedMessage,
  correctionGlob,
  markAsDomainOperation,
  relativeTo,
} from './correction-items.js';

// Story 8.2 / §19 — the pure mapping behind the three correction commands. The shell parts
// (quick picks, modals) are exercised by the VS Code integration suite; this pins the logic.

describe('correction command mapping (§16, §19)', () => {
  it('resolves repository-relative paths and refuses files outside the workspace', () => {
    expect(relativeTo('/repo', '/repo/apps/api/src/a.ts')).toBe('apps/api/src/a.ts');
    expect(relativeTo('/repo/', '/repo/a.ts')).toBe('a.ts');
    expect(relativeTo('/repo', '/elsewhere/a.ts')).toBeUndefined();
    expect(relativeTo('/repo', '/repo')).toBeUndefined();
    // a sibling directory sharing the prefix is not inside the workspace
    expect(relativeTo('/repo', '/repository/a.ts')).toBeUndefined();
  });

  it('turns a directory into a recursive glob and leaves a file path alone', () => {
    expect(correctionGlob('apps/api/src/deals', true)).toBe('apps/api/src/deals/**');
    expect(correctionGlob('apps/api/src/deals/', true)).toBe('apps/api/src/deals/**');
    expect(correctionGlob('apps/api/src/deals/policy.ts', false)).toBe(
      'apps/api/src/deals/policy.ts',
    );
  });

  it('offers declared contexts, described by their own description or glob count', () => {
    expect(
      contextPickItems([
        { name: 'deals', description: 'Deal lifecycle', paths: ['src/deals/**'] },
        { name: 'search', paths: ['src/search/**', 'src/indexing/**'] },
      ]),
    ).toEqual([
      { label: 'deals', description: 'Deal lifecycle' },
      { label: 'search', description: '2 path glob(s)' },
    ]);
    expect(contextPickItems([])).toEqual([]);
  });

  it('builds the §16 correction operations with a reason for the audit trail (§Z12)', () => {
    expect(markAsDomainOperation('src/deals/**')).toMatchObject({
      kind: 'set-component-role',
      path: 'src/deals/**',
      role: 'domain',
    });
    expect(markAsDomainOperation('src/deals/**').reason.length).toBeGreaterThan(0);
    expect(assignToContextOperation('src/deals/**', 'deals')).toMatchObject({
      kind: 'assign-context',
      path: 'src/deals/**',
      context: 'deals',
    });
  });

  it('the success message names the knowledge category and the undo handle (§3, §Z14)', () => {
    const message = correctionAppliedMessage('assign-context', 'src/deals/**', 'cfg-abc');
    expect(message).toContain('human-confirmed');
    expect(message).toContain('src/deals/**');
    expect(message).toContain('cfg-abc');
  });
});
