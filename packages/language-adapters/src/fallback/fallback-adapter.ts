import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';

import type {
  AnalysisContext,
  DetectionResult,
  GitDiff,
  GraphChangeSet,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  RepositoryFile,
} from '../types.js';

export { addFileFact, fileNodeId } from '../file-node.js';

/**
 * Unsupported files still yield deterministic value: File nodes with evidence, clearly partial
 * (PRD §34 — reported, never silently absent).
 */
class FallbackAdapter implements LanguageAdapter {
  public readonly id = 'fallback';
  public readonly supportedExtensions: readonly string[] = [];

  public detectProject(): Promise<DetectionResult> {
    return Promise.resolve({ detected: true, reason: 'fallback handles any repository' });
  }

  public indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, 'no language adapter — indexed at file level only');
    }
    return Promise.resolve(builder.build());
  }

  /**
   * The fallback claims no extensions, so every changed file is correctly reported as
   * unverifiable at symbol level while still contributing its file-level fact (PRD §24, §34).
   */
  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

export const createFallbackAdapter = (): LanguageAdapter => new FallbackAdapter();
