import {
  createJavaModuleResolver,
  createPythonModuleResolver,
  createTsModuleResolver,
  parseTsPathAliases,
} from '@impactgraph/language-adapters';

import { withWorkspaceResolution, workspacePackages } from './workspace-packages.js';

import type { ModuleResolver, RepositoryFile } from '@impactgraph/language-adapters';

// Story 16.2 — one resolver per language, dispatched by the extension of the file the import was
// written IN. Import syntax is a property of the importing language: `from app.routers import x`
// follows Python's package rules, `import './x.js'` follows Node's. Resolving one with the
// other's rules would either miss real edges or invent wrong ones, so the dispatch is explicit.
//
// Every resolver here answers only from the scanned file set, so no specifier — however many
// leading dots it carries — can ever name a path outside the repository (PRD §42.5).

/**
 * Resolvers are built once per index run and closed over the scanned paths. `.astro` and every
 * other extension fall to the TS resolver: Astro frontmatter uses TypeScript import syntax
 * (ADR-0014), and the TS resolver tries the literal path first, so `'../layouts/Base.astro'`
 * resolves without any Astro-specific rule.
 *
 * `.tf` deliberately has **no entry**, and that is a decision rather than an omission. Terraform's
 * only cross-file reference is `module "x" { source = "./modules/x" }`, which names a *directory*,
 * not a file — a `ModuleResolver` returning one file path could not express it, and assembly would
 * turn it into an `IMPORTS file:…` edge pointing at the wrong thing. The Terraform adapter emits no
 * `ImportReference`s at all; it sees every `.tf` file in one `indexFiles` call and resolves module
 * sources itself into `CONTAINS` edges (`language-adapters/src/terraform/terraform-modules.ts`).
 * A no-op entry here would be dead code that implied otherwise.
 */
export const createModuleResolver = (files: readonly RepositoryFile[]): ModuleResolver => {
  const filePaths = new Set(files.map((file) => file.relativePath));
  const tsconfig = files.find((file) => file.relativePath === 'tsconfig.json');
  const typescript = createTsModuleResolver(
    filePaths,
    tsconfig === undefined ? undefined : parseTsPathAliases(tsconfig.content),
  );
  const byExtension: Readonly<Record<string, ModuleResolver>> = {
    '.py': createPythonModuleResolver(filePaths),
    '.java': createJavaModuleResolver(filePaths),
  };
  // Workspace-package names are checked FIRST and for every language: `@fixture/core` is a
  // package name under Node's rules regardless of which file imported it, and no language
  // resolver can answer it from a path. Only names declared by a manifest in the scanned set
  // match, so a third-party specifier still resolves to nothing.
  const packages = workspacePackages(files, filePaths);
  return (fromFilePath, specifier) => {
    const lower = fromFilePath.toLowerCase();
    const extension = Object.keys(byExtension).find((candidate) => lower.endsWith(candidate));
    const resolver = extension === undefined ? typescript : (byExtension[extension] ?? typescript);
    return withWorkspaceResolution(resolver, packages, filePaths)(fromFilePath, specifier);
  };
};
