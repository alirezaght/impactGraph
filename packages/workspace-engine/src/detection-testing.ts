import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { createCustomDetectionAdapter } from '@impactgraph/framework-adapters';
import { createTypeScriptAdapter } from '@impactgraph/language-adapters';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { CustomDetectionRuleDto } from '@impactgraph/contracts';
import type { CodeGraph } from '@impactgraph/framework-adapters';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// `test_detection_rule` (§Z8, Story 14.3) — run a CANDIDATE rule over one snippet through the
// exact adapter that runs during indexing (`createCustomDetectionAdapter`), so what the tool
// reports is what indexing would emit. Nothing is written: the rule is never added to
// rules.yml, the produced fragment is never persisted, and no repository code is executed.

const MAX_SOURCE_BYTES = 200_000;
const RULE_TEST_CONTEXT: IndexingContext = {
  repositorySnapshotId: 'rule-test',
  analysisRunId: 'rule-test',
  createdAt: '1970-01-01T00:00:00.000Z',
};

export interface DetectionRuleTestRequest {
  readonly rule: CustomDetectionRuleDto;
  readonly snippet?: string | undefined;
  readonly path?: string | undefined;
  readonly fileName?: string | undefined;
}

export interface DetectionRuleTestResult {
  readonly ruleId: string;
  readonly filePath: string;
  readonly matched: boolean;
  readonly detectionReason: string;
  readonly wouldEmitNodes: readonly {
    id: string;
    category: string;
    type: string;
    name: string;
    path?: string | undefined;
    provenance: string;
  }[];
  readonly wouldEmitEdges: readonly {
    id: string;
    type: string;
    sourceId: string;
    targetId: string;
    provenance: string;
  }[];
  readonly warnings: readonly string[];
  readonly persisted: false;
}

interface Source {
  readonly filePath: string;
  readonly content: string;
}

/** Reads a repository-relative file, refusing anything outside the workspace root. */
const readRepositoryFile = (rootDir: string, path: string): Failable<Source> => {
  const target = resolve(rootDir, path);
  const inside = relative(resolve(rootDir), target);
  if (isAbsolute(inside) || inside.startsWith('..')) {
    return failWith('configurationError', `path escapes the workspace: ${path}`);
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return failWith('configurationError', `file not found in the workspace: ${path}`);
  }
  if (statSync(target).size > MAX_SOURCE_BYTES) {
    return failWith('configurationError', `file too large to dry-run a rule against: ${path}`);
  }
  return {
    ok: true,
    value: { filePath: relative(resolve(rootDir), target), content: readFileSync(target, 'utf8') },
  };
};

const sourceFor = (rootDir: string, request: DetectionRuleTestRequest): Failable<Source> => {
  if (request.path !== undefined) {
    return readRepositoryFile(rootDir, request.path);
  }
  if (request.snippet === undefined) {
    return failWith('configurationError', 'provide exactly one of snippet or path');
  }
  return {
    ok: true,
    value: { filePath: request.fileName ?? 'snippet.ts', content: request.snippet },
  };
};

/** The minimal CodeGraph the custom-detection adapter reads: facts of this one file. */
const codeGraphOf = (fragment: GraphFragment): CodeGraph => ({
  nodes: fragment.nodes,
  edges: fragment.edges,
  decorators: fragment.decorators,
  callFacts: fragment.callFacts,
  resolveSymbol: () => undefined,
  importsOf: (filePath) =>
    fragment.imports.filter((reference) => reference.fromFilePath === filePath),
});

const resultOf = (
  rule: CustomDetectionRuleDto,
  source: Source,
  detectionReason: string,
  produced: GraphFragment,
): DetectionRuleTestResult => ({
  ruleId: rule.id,
  filePath: source.filePath,
  matched: produced.nodes.length > 0,
  detectionReason,
  wouldEmitNodes: produced.nodes.map((node) => ({
    id: node.id,
    category: node.category,
    type: node.type,
    name: node.name,
    path: node.path,
    provenance: node.knowledge.provenance,
  })),
  wouldEmitEdges: produced.edges.map((edge) => ({
    id: edge.id,
    type: edge.type,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    provenance: edge.knowledge.provenance,
  })),
  warnings: produced.warnings.map((warning) => warning.message),
  persisted: false,
});

/** §Z8 dry run: parse the source, run the rule's matcher, report what it WOULD emit. */
export const testDetectionRule = async (
  rootDir: string,
  request: DetectionRuleTestRequest,
): Promise<Failable<DetectionRuleTestResult>> => {
  const source = sourceFor(rootDir, request);
  if (!source.ok) {
    return source;
  }
  const parsed = await createTypeScriptAdapter().indexFiles(
    [{ relativePath: source.value.filePath, content: source.value.content }],
    RULE_TEST_CONTEXT,
  );
  const codeGraph = codeGraphOf(parsed);
  const adapter = createCustomDetectionAdapter([request.rule]);
  const detection = await adapter.detect(codeGraph);
  const produced = await adapter.enrich(codeGraph, {
    indexing: RULE_TEST_CONTEXT,
    detection,
  });
  return { ok: true, value: resultOf(request.rule, source.value, detection.reason, produced) };
};
