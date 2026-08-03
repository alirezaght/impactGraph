import {
  detectionFailures,
  determinismFailures,
  foreignFileFailures,
  hostileFailures,
  provenanceFailures,
  unparseableFailures,
  vocabularyFailures,
} from './adapter-contract-checks.js';

import type {
  ContractCheckResult,
  ContractLanguageAdapter,
  LanguageAdapterContractOptions,
} from './adapter-contract-types.js';

/**
 * The reusable §42.1 contract suite every LanguageAdapter must pass.
 *
 * It ships as pure assertion FUNCTIONS rather than a `describe`/`it` block because test-kit
 * declares no test-framework dependency (see package.json: domain + application only) and is
 * itself a dev dependency of the packages under test. Each adapter's own test file iterates
 * `LANGUAGE_ADAPTER_CONTRACT_CHECKS`, awaits `runLanguageAdapterContractChecks`, and asserts
 * that every check reported no failures — so the invariants are enforced by real tests in the
 * `analyzers` project while this module stays framework-agnostic.
 */
export const LANGUAGE_ADAPTER_CONTRACT_CHECKS = Object.freeze([
  'detectProject-reports-a-typed-result-with-a-reason-for-a-matching-fixture',
  'detectProject-does-not-throw-for-a-non-matching-fixture',
  'indexFiles-emits-only-PRD-12-node-and-edge-vocabulary',
  'every-fact-carries-deterministic-provenance-evidence-and-the-context-snapshot',
  'indexing-the-same-files-twice-is-byte-identical',
  'hostile-content-produces-facts-or-warnings-and-never-aborts-the-run',
  'unparseable-content-is-recorded-as-a-warning',
  'nothing-beyond-file-level-facts-is-emitted-outside-supportedExtensions',
] as const);

export type LanguageAdapterContractCheck = (typeof LANGUAGE_ADAPTER_CONTRACT_CHECKS)[number];

const result = (
  name: LanguageAdapterContractCheck,
  failures: readonly string[],
  detail?: string,
): ContractCheckResult => ({
  name,
  status: failures.length === 0 ? 'passed' : 'failed',
  failures,
  ...(detail === undefined ? {} : { detail }),
});

const skipped = (name: LanguageAdapterContractCheck, detail: string): ContractCheckResult => ({
  name,
  status: 'skipped',
  failures: [],
  detail,
});

const runDetectionChecks = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<ContractCheckResult[]> => {
  const matching = await adapter.detectProject({
    filePaths: options.matchingFiles.map((file) => file.relativePath),
  });
  const nonMatching = await adapter.detectProject({ filePaths: options.nonMatchingPaths });
  const expected = options.expectDetectionForNonMatching ?? false;
  const nonMatchingFailures =
    nonMatching.detected === expected
      ? []
      : [`detectProject returned detected=${String(nonMatching.detected)} for a non-matching set`];
  return [
    result(
      'detectProject-reports-a-typed-result-with-a-reason-for-a-matching-fixture',
      detectionFailures(matching.detected, matching.reason, options.fixtureName),
    ),
    result('detectProject-does-not-throw-for-a-non-matching-fixture', nonMatchingFailures),
  ];
};

const runIndexingChecks = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<ContractCheckResult[]> => {
  const first = await adapter.indexFiles(options.matchingFiles, options.context);
  const second = await adapter.indexFiles(options.matchingFiles, options.context);
  return [
    result('indexFiles-emits-only-PRD-12-node-and-edge-vocabulary', vocabularyFailures(first)),
    result(
      'every-fact-carries-deterministic-provenance-evidence-and-the-context-snapshot',
      provenanceFailures(first, options.context.repositorySnapshotId),
    ),
    result('indexing-the-same-files-twice-is-byte-identical', determinismFailures(first, second)),
  ];
};

const runHostileCheck = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<ContractCheckResult> => {
  const control = options.matchingFiles[0];
  if (control === undefined) {
    return skipped(
      'hostile-content-produces-facts-or-warnings-and-never-aborts-the-run',
      'no matching files supplied',
    );
  }
  const fragment = await adapter.indexFiles([...options.hostileFiles, control], options.context);
  return result(
    'hostile-content-produces-facts-or-warnings-and-never-aborts-the-run',
    hostileFailures(
      fragment,
      control.relativePath,
      options.hostileFiles.map((file) => file.relativePath),
    ),
  );
};

const runUnparseableCheck = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<ContractCheckResult> => {
  const name = 'unparseable-content-is-recorded-as-a-warning';
  const file = options.unparseableFile;
  if (file === undefined) {
    return skipped(name, `adapter '${adapter.id}' has no content its parser can fail on`);
  }
  const fragment = await adapter.indexFiles([file, ...options.matchingFiles], options.context);
  return result(name, unparseableFailures(fragment, file.relativePath));
};

const runForeignCheck = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<ContractCheckResult> => {
  const name = 'nothing-beyond-file-level-facts-is-emitted-outside-supportedExtensions';
  if (adapter.supportedExtensions.length === 0) {
    return skipped(name, `adapter '${adapter.id}' claims no extensions (catch-all adapter)`);
  }
  const fragment = await adapter.indexFiles(options.foreignFiles, options.context);
  return result(name, foreignFileFailures(adapter, fragment, options));
};

/**
 * Run every §30 invariant against one adapter and one fixture. Never throws for a contract
 * violation — violations come back as `failures` so the caller reports them all at once.
 */
export const runLanguageAdapterContractChecks = async (
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
): Promise<readonly ContractCheckResult[]> => [
  ...(await runDetectionChecks(adapter, options)),
  ...(await runIndexingChecks(adapter, options)),
  await runHostileCheck(adapter, options),
  await runUnparseableCheck(adapter, options),
  await runForeignCheck(adapter, options),
];
