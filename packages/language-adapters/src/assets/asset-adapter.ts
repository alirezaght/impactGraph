import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact, fileNodeId } from '../file-node.js';
import { deterministicEnvelope, FragmentBuilder } from '../fragment-builder.js';

import {
  classifyAsset,
  flattenLocaleKeys,
  isMigrationPath,
  openApiOperations,
} from './asset-classification.js';
import { lineOfKey } from './asset-ranges.js';

import type { AssetKind } from './asset-classification.js';
import type {
  AnalysisContext,
  DetectionResult,
  GitDiff,
  GraphChangeSet,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  RepositoryFile,
  RepositoryContext,
} from '../types.js';

/**
 * Non-code artifacts as first-class graph nodes (item 8 of the trial follow-up).
 *
 * The trials reported "Important files such as locale JSON, configuration, contracts, and new files
 * were missed". They were not missed by the ranking — they were never in the graph. Every `.json`
 * file got one anonymous `file` node from the fallback adapter and a warning saying no adapter
 * claimed it, so a change that was largely translation and contract work looked like it touched
 * nothing relevant.
 *
 * This adapter gives those files their real type, and — for locale bundles and OpenAPI documents —
 * indexes the entries INSIDE them, because "the locale file changed" and "the
 * `nda.signature_request.subject` key changed" are different facts and only the second one is
 * reviewable.
 *
 * SCOPE, stated rather than approximated (PRD §34): JSON only. YAML assets (`.yml`/`.yaml`) are
 * claimed by the Spring configuration adapter and would need a YAML parser this workspace does not
 * depend on; they still get their file-level fact, and the gap is reported in `indexWarnings`.
 */

const EXTENSIONS: readonly string[] = ['.json'];

/** `locale:<path>#<dotted.key>` — one node per translation key. */
export const translationKeyNodeId = (path: string, key: string): string => `locale:${path}#${key}`;

export const openApiOperationNodeId = (method: string, path: string): string =>
  `operation:${method} ${path}`;

const NODE_TYPE_BY_KIND: Readonly<Record<AssetKind, string>> = {
  'locale-bundle': 'locale-bundle',
  'openapi-document': 'openapi-document',
  'json-schema': 'json-schema',
  'event-definition': 'event-definition',
  'configuration-file': 'configuration-file',
};

interface AssetContext {
  readonly builder: FragmentBuilder;
  readonly file: RepositoryFile;
  readonly indexing: IndexingContext;
  readonly fileEvidenceId: string;
}

const evidenceFor = (context: AssetContext, suffix: string, line: number): string | undefined =>
  context.builder.addEvidence(
    {
      id: `ev:asset:${context.file.relativePath}#${suffix}`,
      kind: 'config-entry',
      source: {
        kind: 'file',
        filePath: context.file.relativePath,
        range: { startLine: line, startColumn: 1, endLine: line, endColumn: 1 },
      },
      repositorySnapshotId: context.indexing.repositorySnapshotId,
      createdAt: context.indexing.createdAt,
    },
    context.file.relativePath,
  );

/**
 * Locale keys, each linked to its bundle by DEFINES_KEY. Ownership, not propagation: reaching the
 * bundle from a key is useful; reaching the bundle's other 400 keys is sibling explosion, and the
 * traversal roster treats DEFINES_KEY accordingly.
 */
const addLocaleKeys = (context: AssetContext, document: unknown): void => {
  const bundleId = `locale:${context.file.relativePath}`;
  for (const { key } of flattenLocaleKeys(document)) {
    const line = lineOfKey(context.file.content, key);
    const evidenceId = evidenceFor(context, key, line);
    if (evidenceId === undefined) {
      continue;
    }
    const nodeId = translationKeyNodeId(context.file.relativePath, key);
    context.builder.addNode(
      {
        id: nodeId,
        category: 'asset',
        type: 'translation-key',
        name: key,
        path: context.file.relativePath,
        knowledge: deterministicEnvelope(context.indexing, [evidenceId], 'configuration'),
      },
      context.file.relativePath,
    );
    context.builder.addEdge(
      {
        id: `edge:defines-key:${nodeId}`,
        type: 'DEFINES_KEY',
        sourceId: bundleId,
        targetId: nodeId,
        knowledge: deterministicEnvelope(context.indexing, [evidenceId], 'configuration'),
      },
      context.file.relativePath,
    );
  }
};

/**
 * OpenAPI operations, each SPECIFIED_BY its document. The node id deliberately mirrors the
 * `route:<VERB> <path>` shape the framework adapters emit, so the cross-stack correlation can join a
 * declared operation to the handler that implements it without either side knowing about the other.
 */
const addOperations = (context: AssetContext, document: unknown): void => {
  const documentId = `openapi:${context.file.relativePath}`;
  for (const operation of openApiOperations(document)) {
    const label = `${operation.method} ${operation.path}`;
    const evidenceId = evidenceFor(context, label, lineOfKey(context.file.content, operation.path));
    if (evidenceId === undefined) {
      continue;
    }
    const nodeId = openApiOperationNodeId(operation.method, operation.path);
    context.builder.addNode(
      {
        id: nodeId,
        category: 'asset',
        type: 'openapi-operation',
        name: operation.operationId ?? label,
        path: context.file.relativePath,
        knowledge: deterministicEnvelope(context.indexing, [evidenceId], 'configuration'),
      },
      context.file.relativePath,
    );
    context.builder.addEdge(
      {
        id: `edge:specified-by:${nodeId}`,
        type: 'SPECIFIED_BY',
        sourceId: nodeId,
        targetId: documentId,
        knowledge: deterministicEnvelope(context.indexing, [evidenceId], 'configuration'),
      },
      context.file.relativePath,
    );
  }
};

const ID_PREFIX: Readonly<Record<AssetKind, string>> = {
  'locale-bundle': 'locale',
  'openapi-document': 'openapi',
  'json-schema': 'schema',
  'event-definition': 'events',
  'configuration-file': 'config',
};

const indexOne = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  indexing: IndexingContext,
): void => {
  addFileFact(builder, file, indexing);
  let document: unknown;
  try {
    document = JSON.parse(file.content);
  } catch {
    builder.warn(file.relativePath, 'parse failure: the file is not valid JSON');
    return;
  }
  const kind = classifyAsset(file.relativePath, document);
  if (kind === undefined) {
    builder.warn(file.relativePath, 'unsupported syntax: the document is empty or not an object');
    return;
  }
  const fileEvidenceId = `ev:file-presence:${file.relativePath}`;
  const assetId = `${ID_PREFIX[kind]}:${file.relativePath}`;
  const evidenceId = evidenceFor({ builder, file, indexing, fileEvidenceId }, 'document', 1);
  if (evidenceId === undefined) {
    return;
  }
  // A migration is a data fact wherever it is written, so the path wins over the JSON shape.
  const typing = isMigrationPath(file.relativePath)
    ? { category: 'data', type: 'migration' }
    : { category: 'asset', type: NODE_TYPE_BY_KIND[kind] };
  builder.addNode(
    {
      id: assetId,
      ...typing,
      name: file.relativePath.slice(file.relativePath.lastIndexOf('/') + 1),
      path: file.relativePath,
      knowledge: deterministicEnvelope(indexing, [evidenceId], 'configuration'),
    },
    file.relativePath,
  );
  // The file node and the typed asset node describe the same bytes; CONTAINS ties them so a diff
  // touching the file reaches the typed node and everything declared inside it.
  builder.addEdge(
    {
      id: `edge:asset-of:${assetId}`,
      type: 'CONTAINS',
      sourceId: fileNodeId(file.relativePath),
      targetId: assetId,
      knowledge: deterministicEnvelope(indexing, [evidenceId], 'configuration'),
    },
    file.relativePath,
  );
  const context: AssetContext = { builder, file, indexing, fileEvidenceId };
  if (kind === 'locale-bundle') {
    addLocaleKeys(context, document);
  }
  if (kind === 'openapi-document') {
    addOperations(context, document);
  }
};

class AssetAdapter implements LanguageAdapter {
  public readonly id = 'asset-json';
  public readonly supportedExtensions: readonly string[] = EXTENSIONS;

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const found = context.filePaths.some((path) => path.toLowerCase().endsWith('.json'));
    return Promise.resolve({
      detected: found,
      reason: found ? 'the repository contains JSON assets' : 'no JSON files',
    });
  }

  public indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      indexOne(builder, file, context);
    }
    return Promise.resolve(builder.build());
  }

  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

export const createAssetAdapter = (): LanguageAdapter => new AssetAdapter();
