import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';
import { sharedTreeSitterParsers } from '../tree-sitter/parsers.js';

import { parseJavaFile } from './parse-java.js';

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

// Story 16.5 — the Java language adapter (PRD §30, ADR-0008): tree-sitter WASM in, PRD §12
// vocabulary out. Deterministic `static-analysis` provenance, evidence with a file range on
// every fact, and the indexing context's snapshot id carried through. Spring's reading of the
// annotations this adapter records lives in packages/framework-adapters (PRD §31).

const EXTENSIONS = ['.java'] as const;

const MANIFESTS = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
];

const detectionReason = (sources: boolean, manifest: boolean): string => {
  if (sources && manifest) {
    return 'Java sources and a Maven/Gradle manifest present';
  }
  if (sources) {
    return 'Java sources present';
  }
  return manifest ? 'JVM build manifest present without .java sources' : 'no Java sources found';
};

class JavaAdapter implements LanguageAdapter {
  public readonly id = 'java';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;
  private readonly parsers: TreeSitterParsers;

  public constructor(parsers: TreeSitterParsers) {
    // Constructed eagerly at composition time; the WASM runtime is not touched until the first
    // parse, so adapter construction stays free of the activation budget (PRD §33).
    this.parsers = parsers;
  }

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const sources = context.filePaths.some((path) => path.toLowerCase().endsWith('.java'));
    const manifest = context.filePaths.some((path) =>
      MANIFESTS.some((name) => path === name || path.endsWith(`/${name}`)),
    );
    return Promise.resolve({ detected: sources, reason: detectionReason(sources, manifest) });
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
    if (!EXTENSIONS.some((extension) => file.relativePath.toLowerCase().endsWith(extension))) {
      // The registry dispatches by extension, but a caller may hand over anything. Guessing at
      // non-Java content with a Java grammar would manufacture facts, so it stops here.
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, 'not a Java source file — indexed at file level only');
      return;
    }
    let result;
    try {
      result = await this.parsers.withSyntaxTree('java', file.content, (root) => {
        parseJavaFile(builder, file, context, root);
        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, `java parse failed, file-level only: ${message}`);
      return;
    }
    for (const warning of result.warnings) {
      builder.warn(file.relativePath, warning);
    }
    if (result.value === undefined) {
      addFileFact(builder, file, context);
      builder.warn(file.relativePath, 'java parse produced no tree — indexed at file level only');
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
export const createJavaAdapter = (
  parsers: TreeSitterParsers = sharedTreeSitterParsers(),
): LanguageAdapter => new JavaAdapter(parsers);
