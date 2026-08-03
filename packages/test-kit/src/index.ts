import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to a fixture repository (PRD §42.2), e.g. fixtureRepoPath('ts-basic'). */
export const fixtureRepoPath = (name: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name);

export { graphGoldenPath, serializeGraphGolden } from './graph-golden.js';
export type { GoldenGraphEdge, GoldenGraphInput, GoldenGraphNode } from './graph-golden.js';
export {
  analysisGoldenPath,
  reviewGoldenPath,
  digest,
  firstRelationship,
  serializeAnalysisGolden,
  serializeReviewGolden,
  shouldUpdateGolden,
} from './analysis-golden.js';
export type {
  GoldenAnalysisInput,
  GoldenFinding,
  GoldenImpact,
  GoldenReviewInput,
} from './analysis-golden.js';
export {
  anAnalysis,
  aComponent,
  anImpact,
  aRequirement,
  aSpecification,
} from './impact-view-builders.js';
export { createFakeModelProvider } from './fakes/model-provider.js';
export type { FakeModelProvider } from './fakes/model-provider.js';
export {
  LANGUAGE_ADAPTER_CONTRACT_CHECKS,
  runLanguageAdapterContractChecks,
} from './adapter-contract.js';
export type { LanguageAdapterContractCheck } from './adapter-contract.js';
export type {
  ContractCheckResult,
  ContractFile,
  ContractIndexingContext,
  ContractLanguageAdapter,
  LanguageAdapterContractOptions,
} from './adapter-contract-types.js';
export { CROSS_STACK_EVALUATIONS } from './evaluation.js';
export {
  candidateMovement,
  formatMovement,
  graphMovement,
  mergeMovement,
  nodeMovement,
  parseGraphNodes,
  parseCandidateGolden,
  parseGraphGolden,
} from './movement.js';
export type { CandidateMovement, GraphMovement, MovementReport } from './movement.js';
export { SAMPLE_EVALUATIONS } from './evaluation-samples.js';
export type { CrossStackEvaluation, ImpactGroundTruth, SampleEvaluation } from './evaluation.js';
