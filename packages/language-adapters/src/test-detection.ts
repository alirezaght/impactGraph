// Test detection by naming convention (Story 2.5) — facts carry `framework-convention`
// provenance because the classification derives from the convention, not parsed semantics.

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

// pytest/unittest discovery names: `test_*.py` and `*_test.py`, anywhere in the tree. Scoped to
// `.py` so the TypeScript conventions above are unaffected.
const PYTHON_TEST_FILE_PATTERN = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;

export const isTestFilePath = (relativePath: string): boolean =>
  TEST_FILE_PATTERN.test(relativePath) ||
  PYTHON_TEST_FILE_PATTERN.test(relativePath) ||
  relativePath.includes('__tests__/') ||
  relativePath.startsWith('test/') ||
  relativePath.includes('/test/');
