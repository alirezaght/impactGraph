import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../fallback/fallback-adapter.js';
import { FragmentBuilder } from '../fragment-builder.js';

import { parseTypeScriptFile } from './parse-source.js';

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

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** TS and JS share one adapter (PRD §30). Parsing is static only — never executes code. */
class TypeScriptAdapter implements LanguageAdapter {
  public readonly id = 'typescript';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const detected = context.filePaths.some((path) =>
      EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension)),
    );
    return Promise.resolve({
      detected,
      reason: detected ? 'TypeScript/JavaScript sources present' : 'no TS/JS sources found',
    });
  }

  public indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      try {
        parseTypeScriptFile(builder, file, context);
      } catch (error) {
        // One pathological file costs one file, never the run (PRD §32, §34).
        addFileFact(builder, file, context);
        const message = error instanceof Error ? error.message : String(error);
        builder.warn(file.relativePath, `parse failed, indexed at file level only: ${message}`);
      }
    }
    return Promise.resolve(builder.build());
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

export const createTypeScriptAdapter = (): LanguageAdapter => new TypeScriptAdapter();
