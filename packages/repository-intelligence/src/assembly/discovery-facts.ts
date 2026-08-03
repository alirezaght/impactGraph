import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import { packageNodeId } from './package-facts.js';

import type { PackageInfo, ScannedFile } from '../scanner/scanner.js';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Generic discovery beyond packages (PRD §15.1, Story 2.1): source/test roots that exist on
// disk (`static-analysis` — the evidence is the directory's presence in the scan), build-config
// files, and manifest-declared entry points (`configuration` — the evidence is the manifest).
// No fitting PRD §12.1 type exists for "source root" vs "test root", so both are emitted as
// repository `directory` nodes — the roster is closed and is not extended here.

const CONVENTIONAL_ROOTS = ['src', 'lib', 'app', 'test', 'tests', '__tests__', 'spec'] as const;

const BUILD_CONFIG_NAMES = ['tsconfig.json', 'Makefile', 'Dockerfile'] as const;
const BUILD_CONFIG_PREFIXES = ['vite.config.', 'esbuild.', 'webpack.config.'] as const;

const isBuildConfigName = (baseName: string): boolean =>
  (BUILD_CONFIG_NAMES as readonly string[]).includes(baseName) ||
  BUILD_CONFIG_PREFIXES.some((prefix) => baseName.startsWith(prefix));

interface DiscoveryState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePaths: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
}

const directoriesOf = (files: readonly ScannedFile[]): ReadonlySet<string> => {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.relativePath.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }
  return directories;
};

const inPackageDir = (info: PackageInfo, name: string): string =>
  info.relativeDir === '' ? name : `${info.relativeDir}/${name}`;

const presenceEvidence = (state: DiscoveryState, path: string, tag: string): string | undefined =>
  state.builder.addEvidence(
    {
      id: `ev:file-presence:${path}:${tag}`,
      kind: 'file-presence',
      source: { kind: 'file', filePath: path },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    path,
  );

/** Conventional source/test roots that exist → `directory` nodes, package CONTAINS root. */
const addRootFacts = (state: DiscoveryState, info: PackageInfo): void => {
  for (const rootName of CONVENTIONAL_ROOTS) {
    const dirPath = inPackageDir(info, rootName);
    if (!state.directories.has(dirPath)) {
      continue;
    }
    const evidenceId = presenceEvidence(state, dirPath, 'root');
    if (evidenceId === undefined) {
      continue;
    }
    state.builder.addNode(
      {
        id: `directory:${dirPath}`,
        category: 'repository',
        type: 'directory',
        name: rootName,
        path: dirPath,
        knowledge: deterministicEnvelope(state.context, [evidenceId], 'static-analysis'),
      },
      dirPath,
    );
    state.builder.addEdge(
      {
        id: `contains:directory:${dirPath}`,
        type: 'CONTAINS',
        sourceId: packageNodeId(info),
        targetId: `directory:${dirPath}`,
        knowledge: deterministicEnvelope(state.context, [evidenceId], 'static-analysis'),
      },
      dirPath,
    );
  }
};

/**
 * Build-config files sitting next to the manifest → CONFIGURES edge onto the owning package.
 * The file node itself already exists (every scanned file gets one from its adapter), so only
 * the configuration relationship is added — no duplicate node.
 */
const addBuildConfigFacts = (state: DiscoveryState, info: PackageInfo): void => {
  for (const filePath of state.filePaths) {
    const lastSlash = filePath.lastIndexOf('/');
    const dir = lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
    if (dir !== info.relativeDir || !isBuildConfigName(filePath.slice(lastSlash + 1))) {
      continue;
    }
    const evidenceId = presenceEvidence(state, filePath, 'build-config');
    if (evidenceId !== undefined) {
      state.builder.addEdge(
        {
          id: `configures:${filePath}->${packageNodeId(info)}`,
          type: 'CONFIGURES',
          sourceId: `file:${filePath}`,
          targetId: packageNodeId(info),
          knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
        },
        filePath,
      );
    }
  }
};

/** Manifest entry points (main/module/bin/exports) that exist → package EXPOSES file. */
const addEntryPointFacts = (state: DiscoveryState, info: PackageInfo): void => {
  for (const entryPoint of info.entryPoints) {
    const filePath = inPackageDir(info, entryPoint.path);
    if (!state.filePaths.has(filePath)) {
      continue; // declared but absent (e.g. points at build output) — not a fact about source
    }
    const evidenceId = state.builder.addEvidence(
      {
        id: `ev:config-entry:${info.manifestPath}:${entryPoint.configKey}:${entryPoint.path}`,
        kind: 'config-entry',
        source: { kind: 'config', filePath: info.manifestPath, configKey: entryPoint.configKey },
        repositorySnapshotId: state.context.repositorySnapshotId,
        createdAt: state.context.createdAt,
      },
      info.manifestPath,
    );
    if (evidenceId !== undefined) {
      state.builder.addEdge(
        {
          id: `exposes:${packageNodeId(info)}->${filePath}`,
          type: 'EXPOSES',
          sourceId: packageNodeId(info),
          targetId: `file:${filePath}`,
          knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
        },
        info.manifestPath,
      );
    }
  }
};

/**
 * Source/test roots, build config, and entry points per discovered package (PRD §15.1).
 * Directory existence carries `static-analysis` provenance; manifest-derived facts carry
 * `configuration`. Only things that exist in the scan are emitted — never guesses.
 */
export const buildDiscoveryFacts = (
  packages: readonly PackageInfo[],
  files: readonly ScannedFile[],
  context: IndexingContext,
): GraphFragment => {
  const builder = new FragmentBuilder('generic-discovery');
  const state: DiscoveryState = {
    builder,
    context,
    filePaths: new Set(files.map((file) => file.relativePath)),
    directories: directoriesOf(files),
  };
  for (const info of packages) {
    addRootFacts(state, info);
    addBuildConfigFacts(state, info);
    addEntryPointFacts(state, info);
  }
  return builder.build();
};
