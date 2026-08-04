// @impactgraph/persistence — hybrid local storage adapters (ADR-0006).
// The repository index is a disposable SQLite cache behind IndexStorePort.

export { openSqliteIndexStore } from './index/sqlite-index-store.js';
export {
  IMPACTGRAPH_DIR,
  CONFIG_FILE,
  isWorkspaceInitialized,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  ensureWorkspaceScaffold,
  indexDatabasePath,
} from './config/config-store.js';
export type { ScaffoldResult } from './config/config-store.js';
export {
  ARCHITECTURE_FILE,
  ALIASES_FILE,
  RULES_FILE,
  readArchitectureConfig,
  writeArchitectureConfig,
  readAliasesConfig,
  writeAliasesConfig,
  readRulesConfig,
  writeRulesConfig,
  scaffoldProjectKnowledgeFiles,
} from './config/project-config.js';
export {
  createSpecificationArtifactStore,
  artifactsPath,
} from './artifacts/specification-store.js';
export { createImpactAnalysisArtifactStore } from './artifacts/impact-analysis-store.js';
export { createClarificationArtifactStore } from './artifacts/clarification-store.js';

// Item 12: recorded outcomes and their measured accuracy. Strictly append-only, no update path.
export {
  ACTUAL_IMPACT_SCHEMA_VERSION,
  createActualImpactStore,
} from './artifacts/actual-impact-store.js';
export type { ActualImpactRecord, ActualImpactStore } from './artifacts/actual-impact-store.js';
