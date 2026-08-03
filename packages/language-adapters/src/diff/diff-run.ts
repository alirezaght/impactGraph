import { addFileFact } from '../file-node.js';
import { FragmentBuilder } from '../fragment-builder.js';

import { collectFileFacts } from './file-facts.js';

import type { FileFacts } from './file-facts.js';
import type {
  AnalysisContext,
  FileChangeAnalysis,
  GraphFragment,
  IndexingContext,
  ParseWarning,
  RepositoryFile,
} from '../types.js';

/** The adapter capabilities `analyzeDiff` reuses — the SAME indexer `indexFiles` runs on. */
export interface DiffIndexer {
  readonly adapterId: string;
  readonly supportedExtensions: readonly string[];
  readonly indexFiles: (
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ) => Promise<GraphFragment>;
}

/** Mutable accumulator for one analyzeDiff call. Never shared across calls. */
export interface DiffRun {
  readonly context: AnalysisContext;
  readonly indexer: DiffIndexer;
  readonly currentContent: ReadonlyMap<string, string>;
  readonly previousContent: ReadonlyMap<string, string>;
  readonly fragments: GraphFragment[];
  readonly removedNodeIds: string[];
  readonly removedEdgeIds: string[];
  readonly removedFilePaths: string[];
  readonly invalidatedFilePaths: string[];
  readonly fileChanges: FileChangeAnalysis[];
  readonly warnings: ParseWarning[];
}

const contentMap = (files: readonly RepositoryFile[]): ReadonlyMap<string, string> =>
  new Map(files.map((file) => [file.relativePath, file.content]));

export const createDiffRun = (context: AnalysisContext, indexer: DiffIndexer): DiffRun => ({
  context,
  indexer,
  currentContent: contentMap(context.files),
  previousContent: contentMap(context.previousFiles ?? []),
  fragments: [],
  removedNodeIds: [],
  removedEdgeIds: [],
  removedFilePaths: [],
  invalidatedFilePaths: [],
  fileChanges: [],
  warnings: [],
});

/** A NUL byte is the standard binary sniff; binary content is never fed to a parser. */
const isBinary = (content: string): boolean => content.includes('\u0000');

const hasSupportedExtension = (indexer: DiffIndexer, path: string): boolean => {
  const lower = path.toLowerCase();
  return indexer.supportedExtensions.some((extension) => lower.endsWith(extension));
};

/**
 * Why this file cannot be compared at symbol level, or undefined when it can. Reported, never
 * guessed around (PRD §24 Unverifiable).
 */
export const unverifiableReason = (
  run: DiffRun,
  path: string,
  content: string | undefined,
): string | undefined => {
  if (!hasSupportedExtension(run.indexer, path)) {
    return `extension not supported by adapter '${run.indexer.adapterId}' — no symbol data`;
  }
  if (content === undefined) {
    return 'current content was not supplied — no symbol data';
  }
  if (isBinary(content)) {
    return 'binary content — not comparable at symbol level';
  }
  return undefined;
};

/** Parse one file with the adapter's own indexer and reduce it to comparable facts. */
export const indexOneFile = async (
  run: DiffRun,
  path: string,
  content: string,
): Promise<{ fragment: GraphFragment; facts: FileFacts }> => {
  const fragment = await run.indexer.indexFiles([{ relativePath: path, content }], run.context);
  return { fragment, facts: collectFileFacts(path, fragment, content) };
};

/**
 * Facts the baseline revision contributed for `path`, or undefined when the caller supplied no
 * baseline content. Baseline parse warnings are surfaced, prefixed so their origin is obvious.
 */
export const baselineFacts = async (run: DiffRun, path: string): Promise<FileFacts | undefined> => {
  const content = run.previousContent.get(path);
  if (content === undefined) {
    return undefined;
  }
  const { fragment, facts } = await indexOneFile(run, path, content);
  for (const warning of fragment.warnings) {
    run.warnings.push({ ...warning, message: `baseline: ${warning.message}` });
  }
  return facts;
};

/** File-level-only facts for a file this adapter cannot parse — degrade, never vanish (§34). */
export const fileLevelFragment = (run: DiffRun, file: RepositoryFile): GraphFragment => {
  const builder = new FragmentBuilder(run.indexer.adapterId);
  addFileFact(builder, file, run.context);
  return builder.build();
};
