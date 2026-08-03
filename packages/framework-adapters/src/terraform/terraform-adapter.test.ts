import { createTerraformAdapter } from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createTerraformFrameworkAdapter } from './terraform-adapter.js';

import type { CodeGraph } from '../types.js';
import type {
  GraphFragment,
  IndexingContext,
  RepositoryFile,
} from '@impactgraph/language-adapters';

// PRD §31/§34 — what Terraform enrichment does when the graph does NOT give it what it needs. The
// happy path is pinned by the full-pipeline golden (`packages/test-kit/goldens/terraform-gcp.
// graph.txt`); these are the degradations that must stay visible rather than becoming silence.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-tf',
  analysisRunId: 'run-tf',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const graphOf = (fragment: GraphFragment): CodeGraph => ({
  nodes: fragment.nodes,
  edges: fragment.edges,
  decorators: fragment.decorators,
  callFacts: fragment.callFacts,
  symbolReferences: fragment.symbolReferences,
  resolveSymbol: () => undefined,
  importsOf: () => [],
});

const enrichAll = async (files: readonly RepositoryFile[]): Promise<GraphFragment> => {
  const graph = graphOf(await createTerraformAdapter().indexFiles(files, CONTEXT));
  return createTerraformFrameworkAdapter().enrich(graph, {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });
};

const edgeIds = (fragment: GraphFragment): string[] =>
  fragment.edges.map((edge) => `${edge.type}|${edge.sourceId}->${edge.targetId}`).sort();

describe('Terraform framework adapter (PRD §15.2, §31)', () => {
  it('reports a non-detection with the reason it checked', async () => {
    const detection = await createTerraformFrameworkAdapter().detect(
      graphOf(
        await createTerraformAdapter().indexFiles(
          [{ relativePath: 'notes.md', content: '# nothing' }],
          CONTEXT,
        ),
      ),
    );
    expect(detection).toEqual({
      detected: false,
      evidenceIds: [],
      reason: 'no Terraform blocks found',
    });
  });

  it('resolves references across files in the same directory (= one Terraform module)', async () => {
    const fragment = await enrichAll([
      {
        relativePath: 'infra/main.tf',
        content:
          'resource "google_pubsub_topic" "t" {\n  name = "t"\n  labels = { env = var.env }\n}\n',
      },
      { relativePath: 'infra/variables.tf', content: 'variable "env" {\n  type = string\n}\n' },
    ]);
    expect(edgeIds(fragment)).toEqual([
      'DEPENDS_ON|terraform:infra/google_pubsub_topic.t->terraform:infra/var.env',
    ]);
  });

  it('does not resolve a reference across module boundaries — it reports it', async () => {
    const fragment = await enrichAll([
      {
        relativePath: 'infra/main.tf',
        content: 'resource "google_pubsub_topic" "t" {\n  name = other_type.elsewhere.id\n}\n',
      },
      {
        relativePath: 'infra/modules/x/main.tf',
        content: 'resource "other_type" "elsewhere" {\n  name = "e"\n}\n',
      },
    ]);
    expect(fragment.edges).toEqual([]);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      "reference 'other_type.elsewhere' names nothing declared in this Terraform module",
    );
  });

  it('reports a non-local module source rather than inventing its contents', async () => {
    const fragment = await enrichAll([
      {
        relativePath: 'infra/main.tf',
        content: 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n',
      },
    ]);
    expect(fragment.edges).toEqual([]);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'is not a local path',
    );
  });

  it('expands a literal count into one node per instance and links the whole set', async () => {
    const files = [
      {
        relativePath: 'infra/main.tf',
        content: [
          'resource "google_pubsub_topic" "shard" {',
          '  count = 2',
          '}',
          '',
          'output "names" {',
          '  value = google_pubsub_topic.shard[*].name',
          '}',
        ].join('\n'),
      },
    ];
    const nodes = (await createTerraformAdapter().indexFiles(files, CONTEXT)).nodes.map((node) =>
      String(node.id),
    );
    expect(nodes).toContain('terraform:infra/google_pubsub_topic.shard[0]');
    expect(nodes).toContain('terraform:infra/google_pubsub_topic.shard[1]');
    expect(nodes).not.toContain('terraform:infra/google_pubsub_topic.shard');
    // A reference to the set names every instance, because that is what the set is.
    expect(edgeIds(await enrichAll(files))).toEqual([
      'DEPENDS_ON|terraform:infra/output.names->terraform:infra/google_pubsub_topic.shard[0]',
      'DEPENDS_ON|terraform:infra/output.names->terraform:infra/google_pubsub_topic.shard[1]',
    ]);
  });

  it.each([
    ['count = var.enabled ? 1 : 0', "'count' is an expression"],
    ['for_each = toset(["a", "b"])', "'for_each' keys are not evaluated"],
    ['count = 99', 'exceeds the 10-instance expansion cap'],
  ])('reports %s as one node with unresolved multiplicity', async (line, expected) => {
    const fragment = await createTerraformAdapter().indexFiles(
      [
        {
          relativePath: 'infra/main.tf',
          content: `resource "google_pubsub_topic" "t" {\n  ${line}\n}\n`,
        },
      ],
      CONTEXT,
    );
    expect(fragment.nodes.map((node) => String(node.id))).toContain(
      'terraform:infra/google_pubsub_topic.t',
    );
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(expected);
  });

  it('declares no instance for count = 0, and says so', async () => {
    const fragment = await createTerraformAdapter().indexFiles(
      [
        {
          relativePath: 'infra/main.tf',
          content: 'resource "google_pubsub_topic" "t" {\n  count = 0\n}\n',
        },
      ],
      CONTEXT,
    );
    expect(fragment.nodes.map((node) => node.type)).toEqual(['file']);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain("'count = 0'");
  });

  it('links a resource to the data source it reads', async () => {
    const fragment = await enrichAll([
      {
        relativePath: 'infra/main.tf',
        content: [
          'data "google_secret_manager_secret" "db" {',
          '  secret_id = "db-password"',
          '}',
          '',
          'resource "google_cloud_run_v2_service" "api" {',
          '  secret = data.google_secret_manager_secret.db.secret_id',
          '}',
        ].join('\n'),
      },
    ]);
    expect(edgeIds(fragment)).toContain(
      'DEPENDS_ON|terraform:infra/google_cloud_run_v2_service.api->' +
        'terraform:infra/data.google_secret_manager_secret.db',
    );
  });

  it('binds a .tfvars assignment to the variable it configures, in its own directory', async () => {
    const fragment = await enrichAll([
      { relativePath: 'infra/variables.tf', content: 'variable "region" {\n  type = string\n}\n' },
      { relativePath: 'infra/prod.tfvars', content: 'region = "europe-west3"\n' },
    ]);
    expect(edgeIds(fragment)).toEqual([
      'CONFIGURES|file:infra/prod.tfvars->terraform:infra/var.region',
    ]);
  });

  it('reports a .tfvars assignment whose variable no block in the directory declares', async () => {
    const fragment = await enrichAll([
      { relativePath: 'infra/variables.tf', content: 'variable "region" {\n  type = string\n}\n' },
      { relativePath: 'infra/prod.tfvars', content: 'ghost = "nobody declares this"\n' },
    ]);
    expect(fragment.edges).toEqual([]);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      "'ghost' is assigned a value here, but no variable of that name is declared",
    );
  });

  it('never reads a .tfvars value — only which variable it configures', async () => {
    const fragment = await createTerraformAdapter().indexFiles(
      [{ relativePath: 'infra/prod.tfvars', content: 'api_key = "super-secret-value"\n' }],
      CONTEXT,
    );
    expect(JSON.stringify(fragment)).not.toContain('super-secret-value');
    expect(fragment.callFacts.map((fact) => fact.calleeName)).toEqual(['var.api_key']);
  });

  it('reports a local module source that resolves to nothing indexed', async () => {
    const fragment = await enrichAll([
      {
        relativePath: 'infra/main.tf',
        content: 'module "gone" {\n  source = "./modules/gone"\n}\n',
      },
    ]);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'declares no indexed Terraform blocks',
    );
  });
});
