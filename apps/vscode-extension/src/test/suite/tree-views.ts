import assert from 'node:assert/strict';

import { ARCHITECTURE_SECTIONS, isNodeItem } from '../../views/architecture-sections.js';
import { ArchitectureTreeProvider } from '../../views/architecture-tree.js';
import { ImpactTreeProvider } from '../../views/impact-tree.js';
import { IssuesTreeProvider } from '../../views/issues-tree.js';
import { ReviewTreeProvider } from '../../views/review-tree.js';

import { analyzeViaEngine, reviewViaEngine } from './engine-jobs.js';
import { contributedViewIds } from './manifest.js';
import { openReviewReport } from './review-setup.js';
import { ensureApproved, ensureIndexed } from './workspace-setup.js';

import type { ArchitectureItem, ArchitectureNodeItem } from '../../views/architecture-sections.js';
import type { IntegrationSuite } from '../harness.js';

// PRD §18 / §42.4 "tree views". The four providers are projections: architecture and issues read
// persisted state directly (so a real instance over the indexed fixture is the honest test),
// while impact and review are fed by the workflow commands with a contract-validated engine
// document (so the suite feeds them the same document over the same worker boundary).

const REQUIRED_VIEW_IDS = [
  'impactgraph.architecture',
  'impactgraph.currentImpact',
  'impactgraph.review',
  'impactgraph.issues',
];

/**
 * Walk section → component → file → symbol so the lazy per-level loading is exercised, not just
 * the root. `packages` is the Components section's membership — the same node set the view showed
 * at the top level before §18.6 sections were added.
 */
export const architectureItems = async (): Promise<{
  readonly sections: readonly ArchitectureItem[];
  readonly packages: readonly ArchitectureNodeItem[];
  readonly files: readonly ArchitectureNodeItem[];
  readonly symbols: readonly ArchitectureNodeItem[];
}> => {
  await ensureIndexed();
  const provider = new ArchitectureTreeProvider();
  const sections = await provider.getChildren();
  const components = sections.find(
    (item) => !isNodeItem(item) && item.kind === 'section' && item.id === 'components',
  );
  assert.ok(components !== undefined, 'the architecture view contributes no Components section');
  const packages = (await provider.getChildren(components)).filter(isNodeItem);
  const files: ArchitectureNodeItem[] = [];
  for (const entry of packages) {
    files.push(...(await provider.getChildren(entry)).filter(isNodeItem));
  }
  const symbols: ArchitectureNodeItem[] = [];
  for (const file of files) {
    symbols.push(...(await provider.getChildren(file)).filter(isNodeItem));
  }
  return { sections, packages, files, symbols };
};

export const treeViewsSuite: IntegrationSuite = {
  name: 'tree views (PRD §18, §42.4)',
  tests: [
    {
      name: 'the four data-provider views are contributed',
      run: () => {
        const contributed = new Set(contributedViewIds());
        const missing = REQUIRED_VIEW_IDS.filter((id) => !contributed.has(id));
        assert.deepEqual(missing, [], 'view ids missing from contributes.views');
      },
    },
    {
      name: 'architecture provider returns packages, files and symbols after indexing',
      run: async () => {
        const { packages, files, symbols } = await architectureItems();
        assert.ok(packages.length > 0, 'no package nodes after indexing the fixture');
        assert.ok(files.length > 0, 'packages contain no file nodes');
        assert.ok(symbols.length > 0, 'files contain no symbol nodes');
        const item = new ArchitectureTreeProvider().getTreeItem(files[0] as ArchitectureItem);
        assert.ok(
          typeof item.description === 'string' && item.description.length > 0,
          'file items carry no type/provenance description (§3, §37)',
        );
      },
    },
    {
      name: 'the §18.6 sections are all present and every one resolves children',
      run: async () => {
        const { sections } = await architectureItems();
        assert.deepEqual(
          sections.map((item) => (isNodeItem(item) ? item.node.id : item.id)),
          ARCHITECTURE_SECTIONS.map((section) => section.id),
          'the architecture view no longer opens on the §18.6 sections',
        );
        const provider = new ArchitectureTreeProvider();
        for (const section of sections) {
          const children = await provider.getChildren(section);
          assert.ok(
            children.length > 0,
            `section '${isNodeItem(section) ? '?' : section.id}' rendered nothing at all — an ` +
              'empty section must still state its absence (§43.6)',
          );
        }
      },
    },
    {
      name: 'section, context and note rows never carry a correction contextValue (Epic 08)',
      run: async () => {
        const provider = new ArchitectureTreeProvider();
        const { sections } = await architectureItems();
        const rows = [...sections];
        for (const section of sections) {
          rows.push(...(await provider.getChildren(section)));
        }
        for (const row of rows.filter((entry) => !isNodeItem(entry))) {
          const value = provider.getTreeItem(row).contextValue;
          assert.ok(
            value !== undefined && !/^(package|file|symbol)$/.test(value),
            `a non-node row exposes contextValue '${String(value)}' — the §16 correction menus ` +
              'would appear on a row that owns no path',
          );
        }
        // The rows the menus DO target must keep the exact values `view/item/context` matches.
        const { packages, files, symbols } = await architectureItems();
        assert.equal(provider.getTreeItem(packages[0] as ArchitectureItem).contextValue, 'package');
        assert.equal(provider.getTreeItem(files[0] as ArchitectureItem).contextValue, 'file');
        assert.equal(provider.getTreeItem(symbols[0] as ArchitectureItem).contextValue, 'symbol');
      },
    },
    {
      name: 'issues provider returns items after indexing',
      run: async () => {
        await ensureIndexed();
        const roots = await new IssuesTreeProvider().getChildren();
        assert.ok(roots.length > 0, 'the issues view produced no nodes at all');
        assert.notEqual(
          roots[0]?.kind,
          'empty',
          'the issues view still reports "no workspace/index" after a successful reindex',
        );
      },
    },
    {
      name: 'impact provider projects an analysis document into items',
      run: async () => {
        const root = await ensureApproved();
        const provider = new ImpactTreeProvider();
        provider.setAnalysis(root, await analyzeViaEngine(root));
        const roots = provider.getChildren();
        assert.ok(roots.length > 0, 'the impact tree produced no nodes for a real analysis');
        assert.ok(provider.headline() !== undefined, 'the impact tree exposes no headline');
      },
    },
    {
      name: 'review provider projects a review document into items',
      run: async () => {
        const root = await ensureApproved();
        const provider = new ReviewTreeProvider();
        provider.setReport(root, await reviewViaEngine(root));
        assert.ok(provider.getChildren().length > 0, 'the review tree produced no nodes');
      },
    },
    {
      name: 'the wired review view receives the report the review command produced',
      run: async () => {
        const document = await openReviewReport();
        assert.ok(
          document.getText().length > 0,
          'Open Review Report produced an empty document — the review tree was never populated',
        );
      },
    },
  ],
};
