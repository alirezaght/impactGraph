/**
 * Categorized indexing warnings (item 10: "Tens of thousands of indexing warnings were shown only
 * as a raw count").
 *
 * A count is unactionable. "38,412 warnings" could be one broken parser or 38,412 vendored files
 * nobody cares about, and the reader has no way to tell — so the number gets ignored, which is worse
 * than not reporting it. Categories make the number readable, and pairing each category with the
 * paths it covers makes it possible to answer the question that actually matters: do these gaps
 * overlap the area the analysis is about?
 */
export const INDEX_WARNING_CATEGORIES = [
  /** The file was claimed by an adapter and the parse failed. Real coverage loss. */
  'parse-failure',
  /** Parsed, but the adapter met a construct it does not model. Partial coverage. */
  'unsupported-syntax',
  /** An import specifier could not be resolved to a file, so an edge is missing. */
  'unresolved-import',
  /** A referenced symbol was not found, so a CALLS/EXTENDS edge is missing. */
  'unresolved-symbol',
  /** Deliberately not indexed (ignore globs, secret exclusions, size limits). Not a defect. */
  'ignored-file',
  /** A generated artifact the source references but which was not present at index time. */
  'missing-generated-file',
  /** Resolves outside the workspace: a third-party package or another repository. */
  'external-dependency',
  /** The index is out of date relative to the working tree or HEAD. */
  'stale-index',
  /** No adapter claimed the extension — indexed at file level only. Expected degradation. */
  'no-adapter',
  'other',
] as const;

export type IndexWarningCategory = (typeof INDEX_WARNING_CATEGORIES)[number];

/** Categories that mean real analysis coverage was lost, as opposed to deliberate omission. */
export const COVERAGE_LOSING_CATEGORIES: readonly IndexWarningCategory[] = [
  'parse-failure',
  'unsupported-syntax',
  'unresolved-import',
  'unresolved-symbol',
  'missing-generated-file',
];

export interface IndexWarningGroup {
  readonly category: IndexWarningCategory;
  readonly count: number;
  /** A bounded sample of affected paths — enough to act on, never the whole list. */
  readonly examplePaths: readonly string[];
  /** One representative message. */
  readonly exampleMessage?: string;
  /**
   * True when at least one path in this category is inside the area the analysis predicted. This is
   * the field that turns a warning count into a caveat on a specific result.
   */
  readonly affectsPredictedArea: boolean;
}

export interface IndexWarningReport {
  readonly totalCount: number;
  readonly groups: readonly IndexWarningGroup[];
  /** Sum over `COVERAGE_LOSING_CATEGORIES`. The number worth acting on. */
  readonly coverageLosingCount: number;
  /** True when any coverage-losing category touches the predicted area. */
  readonly affectsPredictedArea: boolean;
}

interface Bucket {
  count: number;
  paths: string[];
  message?: string;
  affects: boolean;
}

/** One group per category present, in vocabulary order, with bounded examples. */
const groupByCategory = (
  warnings: readonly RawIndexWarning[],
  predictedPaths: ReadonlySet<string>,
): readonly IndexWarningGroup[] => {
  const buckets = new Map<IndexWarningCategory, Bucket>();
  for (const warning of warnings) {
    const category = warning.category ?? categorizeWarningMessage(warning.message);
    const bucket = buckets.get(category) ?? { count: 0, paths: [], affects: false };
    bucket.count += 1;
    if (bucket.paths.length < EXAMPLE_LIMIT && !bucket.paths.includes(warning.path)) {
      bucket.paths.push(warning.path);
    }
    bucket.message ??= warning.message;
    bucket.affects = bucket.affects || predictedPaths.has(warning.path);
    buckets.set(category, bucket);
  }
  return INDEX_WARNING_CATEGORIES.filter((category) => buckets.has(category)).map((category) => {
    const bucket = buckets.get(category);
    return {
      category,
      count: bucket?.count ?? 0,
      examplePaths: bucket?.paths ?? [],
      ...(bucket?.message === undefined ? {} : { exampleMessage: bucket.message }),
      affectsPredictedArea: bucket?.affects ?? false,
    };
  });
};

/**
 * Fold the bulk ignored-file count into the `ignored-file` group, replacing any per-file entries'
 * count rather than adding a second group of the same category.
 */
const withIgnoredCount = (
  groups: readonly IndexWarningGroup[],
  ignored: number,
): readonly IndexWarningGroup[] => {
  if (ignored === 0) {
    return groups;
  }
  const existing = groups.find((group) => group.category === 'ignored-file');
  const merged: IndexWarningGroup = {
    category: 'ignored-file',
    count: ignored + (existing?.count ?? 0),
    examplePaths: existing?.examplePaths ?? [],
    exampleMessage:
      existing?.exampleMessage ??
      'excluded by an ignore glob or by .gitignore — check that no source directory is caught by an over-broad pattern',
    affectsPredictedArea: existing?.affectsPredictedArea ?? false,
  };
  return [...groups.filter((group) => group.category !== 'ignored-file'), merged];
};

/** Patterns that identify a category from an adapter's free-text warning message. */
const MESSAGE_RULES: readonly (readonly [RegExp, IndexWarningCategory])[] = [
  [/no language adapter/i, 'no-adapter'],
  [/\b(parse|syntax) (error|failure|failed)|failed to parse|unparse/i, 'parse-failure'],
  [
    /could not resolve (the )?import|unresolved import|module not found|cannot find module/i,
    'unresolved-import',
  ],
  [
    /unresolved symbol|unknown symbol|could not resolve (the )?(symbol|reference)/i,
    'unresolved-symbol',
  ],
  [/generated|codegen|not generated yet|run .*generate/i, 'missing-generated-file'],
  [/node_modules|third[- ]party|outside the workspace|external package/i, 'external-dependency'],
  [/ignored|skipped|excluded|too large|binary/i, 'ignored-file'],
  [/unsupported|not modelled|not modeled|not supported|cannot represent/i, 'unsupported-syntax'],
  [/stale|out of date/i, 'stale-index'],
];

export const categorizeWarningMessage = (message: string): IndexWarningCategory => {
  for (const [pattern, category] of MESSAGE_RULES) {
    if (pattern.test(message)) {
      return category;
    }
  }
  return 'other';
};

export interface RawIndexWarning {
  readonly path: string;
  readonly message: string;
  /** Pre-assigned category when the producer already knows it; otherwise inferred. */
  readonly category?: IndexWarningCategory;
}

const EXAMPLE_LIMIT = 5;

/**
 * Group warnings by category. `predictedPaths` is what makes the report say something about THIS
 * analysis rather than about the repository in general; pass an empty set when there is no analysis
 * in hand and `affectsPredictedArea` is reported as false, which is then literally true.
 */
/**
 * Extra counts the producer knows but has no per-file warning for.
 *
 * The scanner does not emit one warning per ignored file — on a real repository that is tens of
 * thousands of lines for `node_modules` alone. But "ignored files" is a category a reader has to be
 * able to see, because an over-broad `.gitignore` pattern silently removes whole directories from the
 * analysis and there is otherwise nothing to notice. So the COUNT arrives here as a bulk group.
 */
export interface BulkWarningCounts {
  readonly ignoredFileCount?: number;
}

export const categorizeIndexWarnings = (
  warnings: readonly RawIndexWarning[],
  predictedPaths: ReadonlySet<string> = new Set(),
  bulk: BulkWarningCounts = {},
): IndexWarningReport => {
  const ignored = bulk.ignoredFileCount ?? 0;
  const allGroups = withIgnoredCount(groupByCategory(warnings, predictedPaths), ignored);
  const coverageLosing = allGroups.filter((group) =>
    COVERAGE_LOSING_CATEGORIES.includes(group.category),
  );
  return {
    totalCount: warnings.length + ignored,
    groups: allGroups,
    coverageLosingCount: coverageLosing.reduce((sum, group) => sum + group.count, 0),
    affectsPredictedArea: coverageLosing.some((group) => group.affectsPredictedArea),
  };
};
