import { describe, expect, it } from 'vitest';

import { categorizeIndexWarnings, categorizeWarningMessage } from './warning-categories.js';

// Item 10: "Tens of thousands of indexing warnings were shown only as a raw count."

describe('categorizeWarningMessage', () => {
  it.each([
    ['no language adapter — indexed at file level only', 'no-adapter'],
    ['parse error at line 12', 'parse-failure'],
    ['failed to parse the module body', 'parse-failure'],
    ['could not resolve import "@acme/contracts"', 'unresolved-import'],
    ['unresolved symbol DealRepository', 'unresolved-symbol'],
    ['generated client is missing — run pnpm generate', 'missing-generated-file'],
    ['resolves into node_modules', 'external-dependency'],
    ['ignored by an ignore glob', 'ignored-file'],
    ['unsupported syntax: decorators on parameters are not modelled', 'unsupported-syntax'],
    ['index is out of date', 'stale-index'],
    ['something else entirely', 'other'],
  ])('categorizes %j as %s', (message, category) => {
    expect(categorizeWarningMessage(message)).toBe(category);
  });
});

describe('categorizeIndexWarnings', () => {
  const warnings = [
    { path: 'src/a.ts', message: 'parse error at line 3' },
    { path: 'src/b.ts', message: 'parse error at line 9' },
    { path: 'src/c.ts', message: 'could not resolve import "@acme/contracts"' },
    { path: 'vendor/x.js', message: 'no language adapter — indexed at file level only' },
    { path: 'locales/de.json', message: 'ignored by an ignore glob' },
  ];

  it('groups by category with counts and bounded examples', () => {
    const report = categorizeIndexWarnings(warnings);
    expect(report.totalCount).toBe(5);
    const parse = report.groups.find((group) => group.category === 'parse-failure');
    expect(parse?.count).toBe(2);
    expect(parse?.examplePaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(parse?.exampleMessage).toBe('parse error at line 3');
  });

  it('separates real coverage loss from deliberate omission', () => {
    const report = categorizeIndexWarnings(warnings);
    // 2 parse failures + 1 unresolved import; the vendored file and the ignored locale are not
    // coverage loss — they were never meant to be parsed.
    expect(report.coverageLosingCount).toBe(3);
  });

  it('says whether the gaps overlap the predicted area', () => {
    expect(categorizeIndexWarnings(warnings).affectsPredictedArea).toBe(false);
    const overlapping = categorizeIndexWarnings(warnings, new Set(['src/c.ts']));
    expect(overlapping.affectsPredictedArea).toBe(true);
    expect(
      overlapping.groups.find((group) => group.category === 'unresolved-import')
        ?.affectsPredictedArea,
    ).toBe(true);
  });

  it('does not report overlap from a category that loses no coverage', () => {
    const report = categorizeIndexWarnings(warnings, new Set(['locales/de.json']));
    expect(report.affectsPredictedArea).toBe(false);
    expect(
      report.groups.find((group) => group.category === 'ignored-file')?.affectsPredictedArea,
    ).toBe(true);
  });

  it('caps examples so a 40,000-warning run stays readable', () => {
    const many = Array.from({ length: 40_000 }, (_, index) => ({
      path: `src/f${String(index)}.ts`,
      message: 'parse error',
    }));
    const report = categorizeIndexWarnings(many);
    expect(report.totalCount).toBe(40_000);
    expect(report.groups[0]?.examplePaths).toHaveLength(5);
  });

  /**
   * Item 10 names "ignored files" as a required category, and the scanner emits no per-file warning
   * for one — a real repository excludes tens of thousands. The count arrives in bulk, and it matters:
   * a bare `reports/` in .gitignore silently removes every `src/reports/` directory from the analysis,
   * and this line is the only place a reader would notice.
   */
  it('folds the bulk ignored-file count into its own category', () => {
    const report = categorizeIndexWarnings(warnings, new Set(), { ignoredFileCount: 12_000 });
    const ignored = report.groups.find((group) => group.category === 'ignored-file');
    // 12,000 bulk + the one per-file entry already present.
    expect(ignored?.count).toBe(12_001);
    expect(report.totalCount).toBe(12_005);
    // Not coverage loss: an exclusion is deliberate. It is reported so an over-broad pattern is
    // visible, not so it reads as a defect.
    expect(report.coverageLosingCount).toBe(3);
    // One group per category, never two of the same kind.
    expect(report.groups.filter((group) => group.category === 'ignored-file')).toHaveLength(1);
  });

  it('adds no ignored-file group when the producer reports no exclusions', () => {
    const report = categorizeIndexWarnings([], new Set(), { ignoredFileCount: 0 });
    expect(report.groups).toEqual([]);
    expect(report.totalCount).toBe(0);
  });

  it('reports an empty run as empty rather than inventing categories', () => {
    const report = categorizeIndexWarnings([]);
    expect(report.groups).toEqual([]);
    expect(report.coverageLosingCount).toBe(0);
  });

  /**
   * GAP 3 of dogfooding item 9: the run record stores the TRUE warningCount but persists at most
   * 50 warning lines, so a report built from the persisted lines silently maxed out near 50 while
   * `status` reported the real number — two tools disagreeing about the same fact. The report must
   * state its basis: the true total, plus an explicit sampling marker for what was not persisted.
   */
  describe('sampling honesty when the warning list was truncated at write time', () => {
    it('uses the true total and marks the report as sampled', () => {
      const report = categorizeIndexWarnings(warnings, new Set(), { totalWarningCount: 38_412 });
      expect(report.totalCount).toBe(38_412);
      expect(report.sampled).toBe(true);
      expect(report.omittedWarningCount).toBe(38_412 - warnings.length);
    });

    it('combines the true total with the bulk ignored count', () => {
      const report = categorizeIndexWarnings(warnings, new Set(), {
        totalWarningCount: 100,
        ignoredFileCount: 12_000,
      });
      expect(report.totalCount).toBe(12_100);
      expect(report.omittedWarningCount).toBe(95);
    });

    it('does not claim sampling when every warning is present', () => {
      const report = categorizeIndexWarnings(warnings, new Set(), {
        totalWarningCount: warnings.length,
      });
      expect(report.totalCount).toBe(warnings.length);
      expect(report.sampled).toBeUndefined();
      expect(report.omittedWarningCount).toBeUndefined();
    });

    it('never reports a negative omission when the stated total is inconsistent', () => {
      const report = categorizeIndexWarnings(warnings, new Set(), { totalWarningCount: 2 });
      // The warning list in hand is itself evidence of at least warnings.length warnings.
      expect(report.totalCount).toBe(warnings.length);
      expect(report.sampled).toBeUndefined();
      expect(report.omittedWarningCount).toBeUndefined();
    });
  });
});
