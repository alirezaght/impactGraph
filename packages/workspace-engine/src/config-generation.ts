import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { detectConfigDrift } from './config-drift.js';
import { applyConfigOperation } from './config-operations.js';
import { failWith } from './failure.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { DriftItem } from './config-drift.js';
import type { ConfigActor } from './config-operations.js';
import type { Failable } from './failure.js';

// Story 14.1 — detection-first configuration (§Z1/§Z4): the deterministic graph is the
// evidence base; generation = the drift engine's suggestions applied through the governed
// operation path. Every generated field therefore carries reason + confidence in its audit
// entry, and a user can go init → index → generate → analyze with zero manual edits.

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.tf': 'terraform',
  '.prisma': 'prisma',
};

const FRAMEWORK_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@nestjs/core': 'nestjs',
  express: 'express',
  fastify: 'fastify',
  react: 'react',
  astro: 'astro',
  prisma: 'prisma',
};

export interface StackDetection {
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  /** Convention signals present in the graph: migrations, docker, ci, routes, topics. */
  readonly signals: readonly string[];
}

const SIGNAL_BY_NODE_TYPE: Readonly<Record<string, string>> = {
  migration: 'migrations',
  'docker-image': 'docker',
  'deployment-pipeline': 'ci',
  'api-endpoint': 'http-routes',
  topic: 'messaging',
  subscription: 'messaging',
};

const graphEvidence = (
  graph: import('@impactgraph/domain').KnowledgeGraph,
): { languages: string[]; signals: string[] } => {
  const languages = new Set<string>();
  const signals = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.type === 'file' && node.path !== undefined) {
      const language = LANGUAGE_BY_EXTENSION[extname(node.path)];
      if (language !== undefined) {
        languages.add(language);
      }
    }
    const signal = SIGNAL_BY_NODE_TYPE[node.type];
    if (signal !== undefined) {
      signals.add(signal);
    }
  }
  return { languages: [...languages].sort(), signals: [...signals].sort() };
};

const manifestFrameworks = (rootDir: string): string[] => {
  const manifestPath = join(rootDir, 'package.json');
  if (!existsSync(manifestPath)) {
    return [];
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    return names
      .map((name) => FRAMEWORK_DEPENDENCIES[name])
      .filter((framework): framework is string => framework !== undefined)
      .sort();
  } catch {
    return []; // unreadable manifest is not an error — evidence just shrinks
  }
};

/** §Z4 evidence: file extensions + manifest dependencies + graph convention nodes. */
export const detectStack = async (rootDir: string): Promise<Failable<StackDetection>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return failWith(
        'configurationError',
        'no completed index generation — run `impactgraph index` first',
      );
    }
    const evidence = graphEvidence(current.value.graph);
    return {
      ok: true,
      value: {
        languages: evidence.languages,
        frameworks: manifestFrameworks(rootDir),
        signals: evidence.signals,
      },
    };
  });

export interface GenerationOutcome {
  readonly applied: readonly DriftItem[];
  readonly needsReview: readonly DriftItem[];
}

/**
 * §Z1 step 3: generate configuration from repository evidence. Suggestions come from the
 * drift engine and are applied through the governed operation path (audited, validated).
 */
export const generateConfiguration = async (
  rootDir: string,
  actor: ConfigActor,
): Promise<Failable<GenerationOutcome>> => {
  const drift = await detectConfigDrift(rootDir);
  if (!drift.ok) {
    return drift;
  }
  const applied: DriftItem[] = [];
  for (const suggestion of drift.value.suggestions) {
    if (suggestion.suggestedOperation === undefined) {
      continue;
    }
    const result = applyConfigOperation({
      rootDir,
      operation: suggestion.suggestedOperation,
      actor,
      // generation is an explicit user/agent-invoked step — the invocation IS the approval
      approvedByUser: true,
    });
    if (result.ok) {
      applied.push(suggestion);
    }
  }
  return { ok: true, value: { applied, needsReview: drift.value.needsReview } };
};
