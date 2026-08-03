import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';
import { sharedTreeSitterParsers } from '../tree-sitter/parsers.js';

import { readHtmlDocument } from './html-references.js';

import type { HtmlState } from './html-references.js';
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

// Story 16.4 — the standalone HTML language adapter (PRD §30, ADR-0008's `html` grammar, already
// loaded for the Astro template half).
//
// It is deliberately the smallest adapter in the package. PRD §30 says HTML is read for its
// relationships to templates, components, scripts, forms, routes and assets — and NOT treated as
// application architecture — so this adapter declares no symbols, no pages and no routes. Which
// URL an `.html` file is served at depends on a web server this adapter never sees, and inventing
// a `page` node from a file path would be exactly the kind of claim §30 rules out.

const EXTENSIONS = ['.html', '.htm'] as const;

const claims = (relativePath: string): boolean =>
  EXTENSIONS.some((extension) => relativePath.toLowerCase().endsWith(extension));

const detectionReason = (documents: boolean): string =>
  documents ? 'HTML documents present' : 'no HTML documents found';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class HtmlAdapter implements LanguageAdapter {
  public readonly id = 'html';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;
  private readonly parsers: TreeSitterParsers;

  public constructor(parsers: TreeSitterParsers) {
    // Constructed eagerly at composition time; the WASM runtime is not touched until the first
    // parse, so adapter construction stays free of the activation budget (PRD §33).
    this.parsers = parsers;
  }

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const documents = context.filePaths.some((path) => claims(path));
    return Promise.resolve({ detected: documents, reason: detectionReason(documents) });
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
    addFileFact(builder, file, context);
    if (!claims(file.relativePath)) {
      // The registry dispatches by extension, but a caller may hand over anything.
      builder.warn(file.relativePath, 'not an HTML document — indexed at file level only');
      return;
    }
    const state: HtmlState = { builder, context, filePath: file.relativePath };
    let result;
    try {
      result = await this.parsers.withSyntaxTree('html', file.content, (root) => {
        readHtmlDocument(state, root);
        return true;
      });
    } catch (error) {
      builder.warn(file.relativePath, `html parse failed, file-level: ${messageOf(error)}`);
      return;
    }
    for (const warning of result.warnings) {
      builder.warn(file.relativePath, `html document: ${warning}`);
    }
    if (result.value === undefined) {
      builder.warn(file.relativePath, 'html parse produced no tree — indexed at file level only');
    }
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

/** `parsers` is injectable so a bundled host can supply its own grammar bytes (ADR-0008). */
export const createHtmlAdapter = (
  parsers: TreeSitterParsers = sharedTreeSitterParsers(),
): LanguageAdapter => new HtmlAdapter(parsers);
