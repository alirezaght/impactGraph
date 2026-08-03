import { describe, expect, it } from 'vitest';

import { createAstroAdapter } from './astro-adapter.js';

import type { CallFact, IndexingContext } from '../types.js';

// Story 16.4/16.6 — the two template facts the Astro adapter gained: the verb a `<form>` declares,
// and `client:*` hydration directives. Both are raw material on the CallFact channel; neither
// invents a node or an edge, and this suite pins that boundary as much as the facts themselves.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-astro',
  analysisRunId: 'run-astro',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const factsOf = async (template: string): Promise<readonly CallFact[]> => {
  const fragment = await createAstroAdapter().indexFiles(
    [
      {
        relativePath: 'src/pages/deals.astro',
        content: `---\nimport Counter from '../components/Counter.astro';\n---\n${template}\n`,
      },
    ],
    CONTEXT,
  );
  return fragment.callFacts;
};

const describeFact = (fact: CallFact): string =>
  `${fact.receiverName ?? ''}|${fact.calleeName}|${fact.stringArguments.join(',')}` +
  `|${fact.keywordStringArguments?.['method'] ?? ''}`;

describe('Astro template facts', () => {
  it('records the verb a form declares, normalized to the case routes use', async () => {
    expect((await factsOf('<form method="post" action="/api/deals"></form>')).map(describeFact)) //
      .toEqual(['astro:template|form.action|/api/deals|POST']);
  });

  it('records no verb for a form that declares none — the default is the consumer’s call', async () => {
    expect((await factsOf('<form action="/api/deals"></form>')).map(describeFact)).toEqual([
      'astro:template|form.action|/api/deals|',
    ]);
  });

  it('records client:* directives against the component they hydrate', async () => {
    const facts = await factsOf('<Counter client:visible initial="0" />');
    expect(facts.map(describeFact)).toEqual(['astro:client-directive|client:visible|Counter|']);
  });

  // epic-16 — the Astro reader now records a repository-local asset the way the `.html` adapter
  // always has. `packages/test-kit/goldens/astro-site.graph.txt` pins the resulting IMPORTS edge;
  // what belongs here is the split between an asset that IS a file and one that is not.
  it('turns a repository-local asset reference into an ImportReference, not a CallFact', async () => {
    const fragment = await createAstroAdapter().indexFiles(
      [
        {
          relativePath: 'src/pages/deals.astro',
          content: `---\n---\n<script src="../scripts/filter.ts"></script>\n<link rel="stylesheet" href="./deals.css" />\n`,
        },
      ],
      CONTEXT,
    );
    expect(fragment.imports.map((reference) => reference.specifier)).toEqual([
      '../scripts/filter.ts',
      './deals.css',
    ]);
    expect(fragment.callFacts).toEqual([]);
  });

  it('leaves root-relative, remote and navigation targets on the CallFact channel', async () => {
    const facts = await factsOf(
      '<img src="/hero.svg" />\n<script src="https://cdn.example.com/a.js"></script>\n' +
        '<a href="./about.astro">About</a>',
    );
    expect(facts.map(describeFact)).toEqual([
      'astro:template|img.src|/hero.svg|',
      'astro:template|script.src|https://cdn.example.com/a.js|',
      // A navigation target is never a file, even when it looks exactly like one.
      'astro:template|a.href|./about.astro|',
    ]);
  });

  it('claims no node or edge for a hydration directive', async () => {
    const fragment = await createAstroAdapter().indexFiles(
      [
        {
          relativePath: 'src/pages/deals.astro',
          content: '---\n---\n<Counter client:load />\n',
        },
      ],
      CONTEXT,
    );
    // The page's own component node and its CONTAINS edge, and nothing hydration-shaped.
    expect(fragment.nodes.map((node) => node.type)).toEqual(['file', 'ui-component']);
    expect(fragment.edges.map((edge) => edge.type)).toEqual(['CONTAINS']);
  });
});
