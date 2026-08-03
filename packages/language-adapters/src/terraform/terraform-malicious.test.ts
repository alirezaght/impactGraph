import { describe, expect, it } from 'vitest';

import { createTerraformAdapter } from './terraform-adapter.js';
import { resolveLocalModuleDirectory } from './terraform-modules.js';

import type { IndexingContext, RepositoryFile } from '../types.js';

// PRD §42.5, §35 — repository content is untrusted, and Terraform is the sharpest case of it: a
// `.tf` file is a program for another tool. A hostile one may at worst produce a wrong fact; it
// may never cause an evaluation, reach a path outside the repository, or end the run.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-hostile',
  analysisRunId: 'run-hostile',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const CONTROL: RepositoryFile = {
  relativePath: 'infra/control.tf',
  content: 'resource "google_pubsub_topic" "control" {\n  name = "control"\n}\n',
};

const HOSTILE: readonly RepositoryFile[] = [
  {
    // `file()`, `templatefile()` and provisioners are read as text. Nothing is invoked, no file is
    // opened, no command is run — the adapter has no code path that could (PRD §35).
    relativePath: 'infra/exec.tf',
    content: [
      'resource "null_resource" "evil" {',
      '  provisioner "local-exec" {',
      '    command = "rm -rf /"',
      '  }',
      '  secrets = file("/etc/shadow")',
      '  rendered = templatefile("../../../../etc/passwd", {})',
      '}',
    ].join('\n'),
  },
  {
    relativePath: 'infra/traversal.tf',
    content:
      'module "escape" {\n  source = "../../../../../../etc"\n}\n\nmodule "absolute" {\n  source = "/etc/passwd"\n}\n',
  },
  {
    // Broken beyond repair: tree-sitter recovers, the adapter reports, the run continues.
    relativePath: 'infra/broken.tf',
    content: 'resource "a" {{{ \n  = = =\nvariable\n',
  },
  {
    relativePath: 'infra/-looks-like-a-flag.tf',
    content: 'variable "flag" {\n  default = "--force"\n}\n',
  },
  {
    relativePath: 'infra/deep.tf',
    content: `locals {\n  x = ${'('.repeat(400)}1${')'.repeat(400)}\n}\n`,
  },
  {
    // Injection payloads in labels and attribute values are data and stay data.
    relativePath: 'infra/injection.tf',
    content: [
      'resource "google_pubsub_topic" "\'; DROP TABLE deals; --" {',
      '  name      = "\'; DROP TABLE deals; --"',
      '  secret_id = "../../../../etc/shadow"',
      '}',
    ].join('\n'),
  },
  {
    relativePath: 'infra/name with spaces.tf',
    content: 'resource "google_pubsub_topic" "spaced" {\n  name = "spaced"\n}\n',
  },
];

const indexHostile = () => createTerraformAdapter().indexFiles([...HOSTILE, CONTROL], CONTEXT);

describe('Terraform adapter against hostile content (PRD §42.5, §35, §34)', () => {
  it('indexes hostile files without throwing and never loses the control file', async () => {
    const fragment = await indexHostile();
    expect(fragment.nodes.some((node) => node.id === `file:${CONTROL.relativePath}`)).toBe(true);
    expect(
      fragment.nodes.some((node) => node.id === 'terraform:infra/google_pubsub_topic.control'),
    ).toBe(true);
    for (const file of HOSTILE) {
      const indexed = fragment.nodes.some((node) => node.id === `file:${file.relativePath}`);
      const warned = fragment.warnings.some((warning) => warning.filePath === file.relativePath);
      expect(indexed || warned, `${file.relativePath} produced neither a fact nor a warning`).toBe(
        true,
      );
    }
  });

  it('reports unparseable HCL as a warning rather than a failure', async () => {
    const broken = HOSTILE[2] as RepositoryFile;
    const fragment = await createTerraformAdapter().indexFiles([broken], CONTEXT);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'parsed with error recovery',
    );
    expect(fragment.warnings.every((warning) => warning.adapterId === 'terraform')).toBe(true);
  });

  it('records injection payloads as node names and never as anything executable', async () => {
    const injection = HOSTILE[5] as RepositoryFile;
    const fragment = await createTerraformAdapter().indexFiles([injection], CONTEXT);
    // A wrong fact at worst: the payload survives verbatim as a string, which is the point.
    expect(fragment.nodes.map((node) => node.name)).toContain("'; DROP TABLE deals; --");
    // A traversal-shaped `secret_id` becomes a secret node NAMED that string — it is never used
    // as a path, because nothing in this adapter opens a file.
    expect(fragment.nodes.some((node) => node.type === 'secret')).toBe(true);
  });

  it('never resolves a module source to a directory outside the repository', () => {
    const escapes = [
      '../../../../../../etc',
      './../../..',
      '../..',
      '/etc/passwd',
      'git::https://example.com/mod.git',
      'terraform-aws-modules/vpc/aws',
    ];
    for (const source of escapes) {
      const resolved = resolveLocalModuleDirectory('infra', source);
      // Either refused outright, or resolved to a repository-relative path with no climb left.
      expect(resolved === undefined || !resolved.startsWith('..'), source).toBe(true);
    }
    expect(resolveLocalModuleDirectory('infra', '../infra/modules/x')).toBe('infra/modules/x');
    expect(resolveLocalModuleDirectory('', '../anything')).toBeUndefined();
  });

  it('never resolves an interpolated value — it reports it instead', async () => {
    const fragment = await createTerraformAdapter().indexFiles(
      [
        {
          relativePath: 'infra/interp.tf',
          content:
            'resource "google_cloud_run_v2_service" "s" {\n  name = "${var.env}-api"\n  image = "gcr.io/${var.project}/api:latest"\n}\n',
        },
      ],
      CONTEXT,
    );
    const service = fragment.nodes.find((node) => node.type === 'cloud-run-service');
    // The address, never a stitched-together guess at `"-api"` or `"gcr.io//api:latest"`.
    expect(service?.name).toBe('google_cloud_run_v2_service.s');
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain('interpolates');
  });

  it('produces identical output for the same hostile input twice', async () => {
    expect(JSON.stringify(await indexHostile())).toBe(JSON.stringify(await indexHostile()));
  });
});
