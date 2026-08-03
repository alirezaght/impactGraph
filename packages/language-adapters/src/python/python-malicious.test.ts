import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';
import { createPythonModuleResolver } from './python-modules.js';

import type { IndexingContext, RepositoryFile } from '../types.js';

// PRD §42.5 — repository content is untrusted. A hostile Python file may at worst produce a
// wrong fact; it may never execute code, escape the repository root, or end the run.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-hostile',
  analysisRunId: 'run-hostile',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const CONTROL: RepositoryFile = {
  relativePath: 'app/control.py',
  content: 'def healthy() -> bool:\n    return True\n',
};

const HOSTILE: readonly RepositoryFile[] = [
  {
    // Import-time side effects: the adapter parses, it never imports (PRD §35).
    relativePath: 'app/exec.py',
    content: '__import__("os").system("rm -rf /")\nexec(open("/etc/passwd").read())\n',
  },
  {
    relativePath: 'app/traversal.py',
    content: 'from ................etc.passwd import secrets\nPATH = "../../../../etc/shadow"\n',
  },
  {
    // Broken beyond repair: tree-sitter recovers, the adapter reports, the run continues.
    relativePath: 'app/broken.py',
    content: 'def (:\n  class 3:\n   @@@\n',
  },
  {
    relativePath: 'app/-looks-like-a-flag.py',
    content: 'value = 1\n',
  },
  {
    relativePath: 'app/deep.py',
    content: `x = ${'('.repeat(400)}1${')'.repeat(400)}\n`,
  },
  {
    relativePath: 'app/decorator.py',
    content: '@__import__("os").system\ndef handler():\n    pass\n',
  },
];

describe('Python adapter against hostile content (PRD §42.5, §34)', () => {
  it('indexes hostile files without throwing and never loses the control file', async () => {
    const fragment = await createPythonAdapter().indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(fragment.nodes.some((node) => node.id === 'file:app/control.py')).toBe(true);
    expect(fragment.nodes.some((node) => node.id === 'symbol:app/control.py#healthy')).toBe(true);
    for (const file of HOSTILE) {
      const indexed = fragment.nodes.some((node) => node.id === `file:${file.relativePath}`);
      const warned = fragment.warnings.some((warning) => warning.filePath === file.relativePath);
      expect(indexed || warned, `${file.relativePath} produced neither a fact nor a warning`).toBe(
        true,
      );
    }
  });

  it('reports unparseable content as a warning rather than a failure', async () => {
    const fragment = await createPythonAdapter().indexFiles(
      [HOSTILE[2] as RepositoryFile],
      CONTEXT,
    );
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'parsed with error recovery',
    );
    expect(fragment.warnings.every((warning) => warning.adapterId === 'python')).toBe(true);
  });

  it('never resolves an import to anything outside the scanned file set', () => {
    const scanned = new Set(['app/main.py', 'etc/passwd.py']);
    const resolve = createPythonModuleResolver(scanned);
    const specifiers = [
      '................etc.passwd',
      '..etc.passwd',
      '.....secrets',
      'app.main',
      'etc.passwd',
    ];
    for (const specifier of specifiers) {
      const resolved = resolve('app/traversal.py', specifier);
      // Membership in the scanned set is the guarantee: no amount of `..` can name a path the
      // scanner never handed us, so resolution can never leave the repository.
      expect(resolved === undefined || scanned.has(resolved), specifier).toBe(true);
    }
    expect(resolve('app/traversal.py', '..........home.user.ssh.id_rsa')).toBeUndefined();
  });

  it('produces identical output for the same hostile input twice', async () => {
    const adapter = createPythonAdapter();
    const first = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    const second = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
