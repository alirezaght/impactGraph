// @impactgraph/language-adapters — the only components that understand syntax (PRD §30).

export type {
  RepositoryFile,
  IndexingContext,
  AnalysisContext,
  ParseWarning,
  ImportAlias,
  ImportReference,
  SymbolReference,
  DecoratorFact,
  CallFact,
  ExportedSymbol,
  GraphFragment,
  RepositoryContext,
  DetectionResult,
  ChangedFile,
  FileChangeType,
  GitDiff,
  GraphChangeSet,
  SymbolChange,
  ImportChange,
  FileChangeAnalysis,
  LanguageAdapter,
} from './types.js';
export { analyzeDiffWithIndexer } from './diff/analyze-diff.js';
export type { DiffIndexer } from './diff/analyze-diff.js';
export { FragmentBuilder, deterministicEnvelope, mergeFragments } from './fragment-builder.js';
export { serializeFragment, deserializeFragment } from './fragment-serialization.js';
export type { AdapterRegistry } from './registry.js';
export { createAdapterRegistry } from './registry.js';
export { createFallbackAdapter, addFileFact, fileNodeId } from './fallback/fallback-adapter.js';
export { createTypeScriptAdapter } from './typescript/typescript-adapter.js';
export { createPrismaAdapter } from './prisma/prisma-adapter.js';
export { createPythonAdapter } from './python/python-adapter.js';
export { createPythonModuleResolver, pythonModuleStems } from './python/python-modules.js';
export { createJavaAdapter } from './java/java-adapter.js';
export { createJavaModuleResolver } from './java/java-modules.js';
export { FIELD_TYPE_RECEIVER } from './java/java-types.js';
export { createAstroAdapter } from './astro/astro-adapter.js';
export { splitAstroFile } from './astro/astro-split.js';
export { CLIENT_DIRECTIVE_RECEIVER, TEMPLATE_REFERENCE_RECEIVER } from './astro/astro-template.js';
export { createHtmlAdapter } from './html/html-adapter.js';
export { HTML_REFERENCE_RECEIVER } from './html/html-references.js';
export { createTerraformAdapter } from './terraform/terraform-adapter.js';
export { resolveLocalModuleDirectory } from './terraform/terraform-modules.js';
export { directoryOf, terraformNodeId } from './terraform/terraform-addresses.js';
export {
  CLOUD_RUN_ENV_RECEIVER,
  MODULE_SOURCE_RECEIVER,
  REFERENCE_RECEIVER,
  VARIABLE_VALUE_RECEIVER,
} from './terraform/terraform-graph.js';
export {
  createSpringConfigAdapter,
  NOT_SPRING_CONFIG_WARNING,
  SPRING_PROPERTY_RECEIVER,
} from './spring-config/spring-config-adapter.js';
export { springConfigResource, springModuleOfSource } from './spring-config/spring-resources.js';
export type { SpringConfigResource } from './spring-config/spring-resources.js';
export {
  PUBSUB_CONFIG_NAME_RECEIVER,
  PUBSUB_ENV_RECEIVER,
  unresolvedNameKind,
} from './pubsub-facts.js';
export type { PubSubResourceKind } from './pubsub-facts.js';
export { TREE_SITTER_GRAMMARS, nodeGrammarSource } from './tree-sitter/grammars.js';
export type { GrammarId, GrammarSource } from './tree-sitter/grammars.js';
export { createTreeSitterParsers, sharedTreeSitterParsers } from './tree-sitter/parsers.js';
export type { SyntaxTreeResult, TreeSitterParsers } from './tree-sitter/parsers.js';
export { isTestFilePath } from './test-detection.js';
export type { TsPathAliases, ModuleResolver } from './typescript/module-resolution.js';
export {
  parseTsPathAliases,
  createTsModuleResolver,
  normalizePath,
} from './typescript/module-resolution.js';
