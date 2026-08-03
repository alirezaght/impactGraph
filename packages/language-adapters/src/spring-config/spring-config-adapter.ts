import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact, fileNodeId } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';

import { readPropertiesConfig } from './config-properties.js';
import { readYamlConfig } from './config-yaml.js';
import { springConfigResource } from './spring-resources.js';

import type { ConfigEntry } from './config-entries.js';
import type { SpringConfigResource } from './spring-resources.js';
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

// The Spring property source reader (epic-16, PRD §30).
//
// WHY THIS IS A LANGUAGE ADAPTER AND NOT PART OF THE SPRING FRAMEWORK ADAPTER. A framework adapter
// reads the assembled graph and never opens a file (PRD §31), and `application.yml` is a file. Only
// a language adapter is handed content. So the split is the usual one: this adapter reads what the
// configuration SAYS, and `framework-adapters/spring/spring-value-topics.ts` decides what a
// `@Value` placeholder RESOLVES to — which needs a second file and is therefore a framework job.
//
// WHY IT CLAIMS `.yml`/`.yaml`/`.properties` WHOLESALE. The registry dispatches by extension and
// cannot key on a filename, so claiming Spring's file names is not an option. Every file it is
// handed that is NOT `src/main/resources/application*.{yml,yaml,properties}` gets exactly the
// file-level fact the fallback adapter would have produced, and says so in its warning — the same
// guard `java-adapter.ts` applies to a non-Java file. No graph output changes for a repository
// with no Spring configuration in it; a future YAML-consuming adapter collides here loudly at
// registry construction rather than quietly at runtime.
//
// NOTHING IS EVALUATED. A `${…}` in a value is left exactly as written (the resolver refuses it),
// no placeholder is expanded, no imported configuration is followed, and no profile is chosen.

const EXTENSIONS = ['.yml', '.yaml', '.properties'] as const;

/** Marks a configuration entry: `calleeName` is the flattened key, `stringArguments[0]` the value. */
export const SPRING_PROPERTY_RECEIVER = 'spring:config-property';

/**
 * What this adapter says about a file it claimed by extension but has nothing to read in.
 *
 * Exported because it is EXPECTED DEGRADATION, not a problem report: most YAML in most
 * repositories is not Spring configuration, and the file still gets its file-level fact. Surfaces
 * that summarise warnings filter it exactly as they filter the fallback adapter's equivalent
 * (`workspace-engine/src/indexing.ts`), and the string lives here so the two cannot drift.
 */
export const NOT_SPRING_CONFIG_WARNING =
  'not a Spring configuration resource — indexed at file level only';

const readEntries = (
  resource: SpringConfigResource,
  content: string,
): ReturnType<typeof readYamlConfig> =>
  resource.format === 'yaml' ? readYamlConfig(content) : readPropertiesConfig(content);

interface EmitInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
}

const emitEntry = (input: EmitInput, entry: ConfigEntry): void => {
  const { builder, context, filePath } = input;
  // The key belongs in the evidence id: a file states many entries and, in a multi-document file,
  // may state one key twice. Two records under one id means deduplication silently drops one.
  const evidenceId = builder.addEvidence(
    {
      id: `ev:config-entry:${filePath}:${String(entry.line)}:1:${entry.key}`,
      kind: 'config-entry',
      source: { kind: 'config', filePath, configKey: entry.key },
      repositorySnapshotId: context.repositorySnapshotId,
      createdAt: context.createdAt,
    },
    filePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  builder.addCallFact({
    filePath,
    receiverName: SPRING_PROPERTY_RECEIVER,
    calleeName: entry.key,
    stringArguments: [entry.value],
    identifierArguments: [],
    enclosingSymbolNodeId: fileNodeId(filePath),
    evidenceId,
  });
};

class SpringConfigAdapter implements LanguageAdapter {
  public readonly id = 'spring-config';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const found = context.filePaths.some((path) => springConfigResource(path) !== undefined);
    return Promise.resolve({
      detected: found,
      reason: found
        ? 'Spring configuration under src/main/resources present'
        : 'no src/main/resources/application.* configuration found',
    });
  }

  public indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      this.indexOne(builder, file, context);
    }
    return Promise.resolve(builder.build());
  }

  /** One unreadable file costs one file, never the run (PRD §32, §34, §42.5). */
  private indexOne(builder: FragmentBuilder, file: RepositoryFile, context: IndexingContext): void {
    addFileFact(builder, file, context);
    const resource = springConfigResource(file.relativePath);
    if (resource === undefined) {
      builder.warn(file.relativePath, NOT_SPRING_CONFIG_WARNING);
      return;
    }
    const read = readEntries(resource, file.content);
    for (const entry of read.entries) {
      emitEntry({ builder, context, filePath: file.relativePath }, entry);
    }
    if (read.skippedLines > 0) {
      builder.warn(
        file.relativePath,
        `${String(read.skippedLines)} line(s) state something this reader does not decode ` +
          '(sequence, block scalar, anchor, flow collection, or an escaped key/value) — ' +
          'those entries supply no value',
      );
    }
  }

  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

export const createSpringConfigAdapter = (): LanguageAdapter => new SpringConfigAdapter();
