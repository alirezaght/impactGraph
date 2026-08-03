import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';
import { sharedTreeSitterParsers } from '../tree-sitter/parsers.js';
import { parseTypeScriptFile } from '../typescript/parse-source.js';

import { addAstroComponent } from './astro-component.js';
import { splitAstroFile } from './astro-split.js';
import { readAstroTemplate } from './astro-template.js';

import type { TreeSitterParsers } from '../tree-sitter/parsers.js';
import type {
  AnalysisContext,
  DetectionResult,
  GitDiff,
  GraphChangeSet,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  RepositoryContext,
  RepositoryFile,
} from '../types.js';

// Story 16.4 — the Astro language adapter (PRD §30, ADR-0014). Astro needs no grammar: the file
// is split on its `---` fences, the frontmatter goes to the TypeScript compiler API and the
// template to the tree-sitter `html` grammar, both of which ADR-0008 already sanctions.
//
// Every fact records which half produced it — `astro-frontmatter:` or `astro-template:` in its
// evidence id — and a malformed split degrades to a warning rather than a guess.

const EXTENSIONS = ['.astro'] as const;

const FRONTMATTER_SCOPE = 'astro-frontmatter:';

class AstroAdapter implements LanguageAdapter {
  public readonly id = 'astro';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;
  private readonly parsers: TreeSitterParsers;

  public constructor(parsers: TreeSitterParsers) {
    this.parsers = parsers;
  }

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const sources = context.filePaths.some((path) => path.toLowerCase().endsWith('.astro'));
    const config = context.filePaths.some((path) => /(^|\/)astro\.config\.[cm]?[jt]s$/.test(path));
    return Promise.resolve({
      detected: sources,
      reason: detectionReason(sources, config),
    });
  }

  public async indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      await this.indexOne(builder, file, context);
    }
    return builder.build();
  }

  /** One pathological file costs one file, never the run (PRD §32, §34, §42.5). */
  private async indexOne(
    builder: FragmentBuilder,
    file: RepositoryFile,
    context: IndexingContext,
  ): Promise<void> {
    if (!file.relativePath.toLowerCase().endsWith(EXTENSIONS[0])) {
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, 'not an Astro component file — indexed at file level only');
      return;
    }
    const split = splitAstroFile(file.content);
    if (!split.ok) {
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, `${split.error.reason} — indexed at file level only`);
      return;
    }
    const componentNodeId = addAstroComponent(builder, file, context);
    this.readFrontmatter(builder, file, context, split.value.frontmatter?.paddedSource);
    if (componentNodeId !== undefined) {
      await this.readTemplate(builder, file, context, {
        source: split.value.template.paddedSource,
        componentNodeId,
      });
    }
  }

  private readFrontmatter(
    builder: FragmentBuilder,
    file: RepositoryFile,
    context: IndexingContext,
    source: string | undefined,
  ): void {
    if (source === undefined) {
      return; // a template-only `.astro` file — legal, and simply has no TypeScript half
    }
    try {
      parseTypeScriptFile(builder, file, context, {
        source,
        evidenceScope: FRONTMATTER_SCOPE,
        emitFileFact: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      builder.warn(file.relativePath, `astro frontmatter parse failed: ${message}`);
    }
  }

  private async readTemplate(
    builder: FragmentBuilder,
    file: RepositoryFile,
    context: IndexingContext,
    template: { source: string; componentNodeId: string },
  ): Promise<void> {
    const state = {
      builder,
      context,
      filePath: file.relativePath,
      componentNodeId: template.componentNodeId,
    };
    let result;
    try {
      result = await this.parsers.withSyntaxTree('html', template.source, (root) => {
        readAstroTemplate(state, root);
        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      builder.warn(file.relativePath, `astro template parse failed: ${message}`);
      return;
    }
    reportTemplateWarnings(builder, file.relativePath, result.warnings, result.value === undefined);
  }

  /** Symbol-level diff analysis (PRD §24, §30) reusing this adapter's own indexer. */
  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

const detectionReason = (sources: boolean, config: boolean): string => {
  if (sources && config) {
    return 'Astro components and an astro.config present';
  }
  if (sources) {
    return 'Astro components present';
  }
  return config ? 'astro.config present without .astro components' : 'no Astro components found';
};

/**
 * The `html` grammar cannot represent Astro's JSX expressions (`{items.map(…)}`), so a template
 * containing one always parses with error recovery. That is expected, not a defect — but it does
 * mean facts inside such an expression may be missed, which PRD §34 says must be visible rather
 * than absorbed. The warning says so in those words instead of reporting a syntax error.
 */
const reportTemplateWarnings = (
  builder: FragmentBuilder,
  filePath: string,
  warnings: readonly string[],
  noTree: boolean,
): void => {
  if (noTree) {
    builder.warn(filePath, 'astro template produced no syntax tree — frontmatter facts only');
    return;
  }
  for (const warning of warnings) {
    builder.warn(
      filePath,
      warning.startsWith('parsed with error recovery')
        ? `astro template contains expressions the HTML grammar cannot represent; references inside them are not indexed (${warning})`
        : `astro template: ${warning}`,
    );
  }
};

/** `parsers` is injectable so a bundled host can supply its own grammar bytes (ADR-0008). */
export const createAstroAdapter = (
  parsers: TreeSitterParsers = sharedTreeSitterParsers(),
): LanguageAdapter => new AstroAdapter(parsers);
