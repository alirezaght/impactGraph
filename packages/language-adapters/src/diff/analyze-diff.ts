import { mergeFragments } from '../fragment-builder.js';

import { allRemoved, compareImports, compareSymbols } from './compare-facts.js';
import {
  baselineFacts,
  createDiffRun,
  fileLevelFragment,
  indexOneFile,
  unverifiableReason,
} from './diff-run.js';
import { EMPTY_FILE_FACTS } from './file-facts.js';

import type { DiffIndexer, DiffRun } from './diff-run.js';
import type { FileFacts } from './file-facts.js';
import type {
  AnalysisContext,
  ChangedFile,
  FileChangeAnalysis,
  GitDiff,
  GraphChangeSet,
} from '../types.js';

export type { DiffIndexer } from './diff-run.js';

const unverifiable = (change: ChangedFile, reason: string): FileChangeAnalysis => ({
  path: change.path,
  ...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }),
  changeType: change.changeType,
  symbolLevel: false,
  unverifiableReason: reason,
  symbolChanges: [],
  importChanges: [],
});

const NO_BASELINE = 'baseline content was not supplied — no symbol data';

/** A deleted file loses its whole fragment; with baseline content we can also name what went. */
const handleDeleted = async (run: DiffRun, change: ChangedFile): Promise<void> => {
  run.invalidatedFilePaths.push(change.path);
  run.removedFilePaths.push(change.path);
  const baseline = await baselineFacts(run, change.path);
  if (baseline === undefined) {
    run.fileChanges.push(unverifiable(change, NO_BASELINE));
    return;
  }
  run.removedNodeIds.push(...baseline.nodeIds);
  run.removedEdgeIds.push(...baseline.edgeIds);
  run.fileChanges.push({
    path: change.path,
    changeType: change.changeType,
    symbolLevel: true,
    ...allRemoved(baseline, change.path),
  });
};

/** Baseline facts for a surviving file: an added file has none by definition. */
const baselineFor = async (run: DiffRun, change: ChangedFile): Promise<FileFacts | undefined> => {
  if (change.changeType === 'added') {
    return EMPTY_FILE_FACTS(change.previousPath ?? change.path);
  }
  return baselineFacts(run, change.previousPath ?? change.path);
};

const recordRemovals = (run: DiffRun, baseline: FileFacts, current: FileFacts): void => {
  const nodeIds = new Set(current.nodeIds);
  const edgeIds = new Set(current.edgeIds);
  run.removedNodeIds.push(...baseline.nodeIds.filter((id) => !nodeIds.has(id)));
  run.removedEdgeIds.push(...baseline.edgeIds.filter((id) => !edgeIds.has(id)));
};

/** Added, modified, or renamed: the file still exists, so we re-parse its NEW content. */
const handleSurviving = async (run: DiffRun, change: ChangedFile): Promise<void> => {
  run.invalidatedFilePaths.push(change.path);
  if (change.previousPath !== undefined) {
    run.invalidatedFilePaths.push(change.previousPath);
    run.removedFilePaths.push(change.previousPath);
  }
  const content = run.currentContent.get(change.path);
  const reason = unverifiableReason(run, change.path, content);
  if (reason !== undefined) {
    run.fragments.push(fileLevelFragment(run, { relativePath: change.path, content: '' }));
    run.fileChanges.push(unverifiable(change, reason));
    return;
  }
  if (content === undefined) {
    return; // unreachable: unverifiableReason already covers missing content — narrowing only.
  }
  const { fragment, facts } = await indexOneFile(run, change.path, content);
  run.fragments.push(fragment);
  const baseline = await baselineFor(run, change);
  if (baseline === undefined) {
    run.fileChanges.push(unverifiable(change, NO_BASELINE));
    return;
  }
  recordRemovals(run, baseline, facts);
  run.fileChanges.push({
    path: change.path,
    ...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }),
    changeType: change.changeType,
    symbolLevel: true,
    symbolChanges: compareSymbols(baseline, facts, change.path),
    importChanges: compareImports(baseline, facts, change.path),
  });
};

/**
 * Symbol-level `analyzeDiff` (PRD §30, §24) shared by every language adapter: re-parse the new
 * content of changed files with the adapter's own indexer, compare against the baseline parse,
 * and report per-file symbol/import changes plus the node/edge deltas they imply.
 *
 * Nothing here executes repository code, and no per-file failure escapes: the indexer already
 * degrades a pathological file to a warning (PRD §32, §34, §35).
 */
export const analyzeDiffWithIndexer = async (
  diff: GitDiff,
  context: AnalysisContext,
  indexer: DiffIndexer,
): Promise<GraphChangeSet> => {
  const run = createDiffRun(context, indexer);
  for (const change of diff.changedFiles) {
    if (change.changeType === 'deleted') {
      await handleDeleted(run, change);
    } else {
      await handleSurviving(run, change);
    }
  }
  const fragment = mergeFragments(run.fragments);
  return {
    invalidatedFilePaths: run.invalidatedFilePaths,
    removedFilePaths: run.removedFilePaths,
    fragment,
    removedNodeIds: run.removedNodeIds,
    removedEdgeIds: run.removedEdgeIds,
    fileChanges: run.fileChanges,
    warnings: [...fragment.warnings, ...run.warnings],
  };
};
