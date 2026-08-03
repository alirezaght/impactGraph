import { describe, expect, it } from 'vitest';

import { rangeWithinString } from './json-document.js';
import { createTerraformAdapter } from './terraform-adapter.js';

import type { JsonString } from './json-document.js';
import type { GraphFragment, IndexingContext } from '../types.js';

// epic-16 — `.tf.json`. The claim being tested is the one the earlier decline said could not be
// made: every fact carries a REAL line and column, not a file-level shrug. So most of this suite
// asserts positions, and the rest asserts that a hostile document costs one file and no more.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-tfjson',
  analysisRunId: 'run-tfjson',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (content: string, relativePath = 'infra/main.tf.json'): Promise<GraphFragment> =>
  createTerraformAdapter().indexFiles([{ relativePath, content }], CONTEXT);

/** `<symbolName>@<line>:<column>` for every positioned evidence record the parse produced. */
const positionedEvidence = (fragment: GraphFragment): string[] =>
  fragment.evidence
    .filter((record) => record.kind !== 'file-presence')
    .map((record) => {
      if (record.source.kind !== 'file') {
        return 'not-a-file';
      }
      const range = record.source.range;
      return range === undefined
        ? `${record.source.symbolName ?? ''}@NO-RANGE`
        : `${record.source.symbolName ?? ''}@${String(range.startLine)}:${String(range.startColumn)}`;
    })
    .sort();

describe('sub-ranges inside a JSON string literal', () => {
  const literal = (hasEscapes: boolean): JsonString => ({
    kind: 'string',
    value: 'ab${var.x}',
    range: { startLine: 4, startColumn: 10, endLine: 4, endColumn: 22 },
    contentRange: { startLine: 4, startColumn: 11, endLine: 4, endColumn: 21 },
    hasEscapes,
  });

  it('anchors an offset at the literal’s content, not at its quote', () => {
    expect(rangeWithinString(literal(false), 4, 5)).toEqual({
      startLine: 4,
      startColumn: 15,
      endLine: 4,
      endColumn: 20,
    });
  });

  it('widens to the whole literal when an escape makes offsets unmappable', () => {
    expect(rangeWithinString(literal(true), 4, 5)).toEqual(literal(true).range);
  });
});

describe('the Terraform JSON syntax reader', () => {
  const DOCUMENT = `{
  "variable": { "region": { "type": "string" } },
  "resource": {
    "google_pubsub_topic": {
      "deal_events": { "name": "deal-events" },
      "shard": { "count": 2, "name": "\${var.region}-shard" }
    },
    "google_secret_manager_secret_iam_member": [
      { "reader": { "secret_id": "db-password", "role": "roles/x" } }
    ]
  }
}
`;

  it('produces the same node vocabulary the HCL path produces, with real ranges', async () => {
    const fragment = await index(DOCUMENT);
    expect(
      fragment.nodes
        .filter((node) => node.category === 'infrastructure')
        .map((node) => `${node.id}|${node.type}|${node.name}`)
        .sort(),
    ).toEqual([
      'terraform:infra/google_pubsub_topic.deal_events|pubsub-topic|deal-events',
      'terraform:infra/google_pubsub_topic.shard[0]|pubsub-topic|google_pubsub_topic.shard[0]',
      'terraform:infra/google_pubsub_topic.shard[1]|pubsub-topic|google_pubsub_topic.shard[1]',
      'terraform:infra/google_secret_manager_secret_iam_member.reader|iam-role|google_secret_manager_secret_iam_member.reader',
      'terraform:infra/var.region|terraform-resource|var.region',
      // Secret nodes are keyed by the secret's own name, not by directory — the same id the HCL
      // path produces, so a `.tf.json` binding and a `.tf` binding land on one node.
      'terraform:secret:db-password|secret|db-password',
    ]);
    // Not one parsed fact carries a range-less evidence record — that was the whole reason
    // `.tf.json` was declined. (`file-presence` is file-level for every language, by design.)
    expect(positionedEvidence(fragment).filter((entry) => entry.includes('NO-RANGE'))).toEqual([]);
  });

  it('points every fact at the line and column it is actually written on', async () => {
    expect(positionedEvidence(await index(DOCUMENT))).toEqual([
      // The `variable "region"` declaration, and — separately — the `${var.region}` that reads it
      // six lines down, at the column of the address itself rather than of the attribute.
      'db-password@9:21',
      'google_pubsub_topic.deal_events@5:7',
      'google_pubsub_topic.shard[0]@6:7',
      'google_pubsub_topic.shard[1]@6:7',
      'google_secret_manager_secret_iam_member.reader@9:9',
      'var.region@2:17',
      // Cited ONCE, though two facts reference it: identical evidence records collapse, while
      // `shard[0]` / `shard[1]` above — same position, different symbols — both survive because
      // the symbol is part of the evidence id.
      'var.region@6:41',
    ]);
  });

  it('records a reference at the exact column of the address inside the interpolation', async () => {
    const fragment = await index(`{
  "resource": {
    "google_pubsub_subscription": {
      "worker": { "topic": "\${google_pubsub_topic.deal_events.name}" }
    }
  }
}
`);
    const reference = fragment.callFacts.find(
      (fact) => fact.receiverName === 'terraform:reference',
    );
    expect(reference?.calleeName).toBe('google_pubsub_topic.deal_events');
    // Line 4 column 31 is where `google_pubsub_topic` starts: past the `"topic": "` and past the
    // `${`. Not the start of the line, not the start of the attribute, not the start of the string.
    expect(positionedEvidence(fragment)).toEqual([
      'google_pubsub_subscription.worker@4:7',
      'google_pubsub_topic.deal_events@4:31',
    ]);
  });

  it('reports an interpolated attribute as unresolved instead of guessing its value', async () => {
    const fragment = await index(`{
  "resource": { "google_cloud_run_service": { "api": {
    "name": "deals-api",
    "image": "gcr.io/\${var.project}/api:latest"
  } } }
}
`);
    expect(fragment.warnings.map((warning) => warning.message)).toEqual([
      expect.stringContaining("attribute 'image' at line 4 interpolates"),
    ]);
    // The literal name is still read; one unresolvable attribute does not cost the resource.
    expect(fragment.nodes.some((node) => node.name === 'deals-api')).toBe(true);
  });

  it('binds a .tfvars.json assignment as a variable-value fact', async () => {
    const fragment = await index(
      '{ "region": "eu", "enable_audit": true }',
      'infra/dev.tfvars.json',
    );
    expect(
      fragment.callFacts
        .filter((fact) => fact.receiverName === 'terraform:variable-value')
        .map((fact) => fact.calleeName),
    ).toEqual(['var.region', 'var.enable_audit']);
  });
});

// PRD §42.5 — a `.tf.json` file is untrusted text. Worst case: a wrong fact, never an execution,
// never a traversal, never a crash that costs the run.
describe('hostile .tf.json content', () => {
  it('degrades a malformed document to a warning and keeps the file node', async () => {
    const fragment = await index('{"resource": {"a": {"b": }}}');
    expect(fragment.nodes.map((node) => node.id)).toEqual(['file:infra/main.tf.json']);
    // The refusal names the line tree-sitter recovered at, so "this file was skipped" is
    // actionable rather than mysterious (PRD §34).
    expect(fragment.warnings[0]?.message).toMatch(/well-formed top-level object.*line \d+/);
  });

  it('rejects a non-object document without inventing anything', async () => {
    const fragment = await index('["resource"]');
    expect(fragment.warnings[0]?.message).toContain('must be one well-formed top-level object');
    expect(fragment.nodes.map((node) => node.id)).toEqual(['file:infra/main.tf.json']);
  });

  it('treats prototype-shaped keys as ordinary names, resolving nothing through them', async () => {
    const fragment = await index(`{
  "resource": { "__proto__": { "constructor": { "name": "toString" } } },
  "constructor": { "x": { "y": "z" } },
  "variable": { "__proto__": { "type": "string" } }
}
`);
    const ids = fragment.nodes.map((node) => node.id).sort();
    expect(ids).toEqual([
      'file:infra/main.tf.json',
      'terraform:infra/__proto__.constructor',
      'terraform:infra/var.__proto__',
    ]);
    for (const node of fragment.nodes) {
      expect(typeof node.name).toBe('string');
    }
  });

  it('keeps a traversal-shaped module source and topic name inert text', async () => {
    const fragment = await index(`{
  "module": { "evil": { "source": "../../../../../../etc" } },
  "resource": { "google_pubsub_topic": { "t": { "name": "../../../etc/passwd" } } }
}
`);
    expect(fragment.nodes.some((node) => node.name === '../../../etc/passwd')).toBe(true);
    expect(
      fragment.callFacts
        .filter((fact) => fact.receiverName === 'terraform:module-source')
        .map((fact) => fact.calleeName),
    ).toEqual(['../../../../../../etc']);
  });

  it('does not spin on an unterminated interpolation or a huge one', async () => {
    const fragment = await index(`{
  "resource": { "google_pubsub_topic": { "t": {
    "name": "\${unterminated",
    "labels": "\${${'a.b.'.repeat(400)}c}"
  } } }
}
`);
    expect(fragment.nodes.some((node) => node.id.endsWith('google_pubsub_topic.t'))).toBe(true);
    expect(Array.isArray(fragment.warnings)).toBe(true);
  });
});
