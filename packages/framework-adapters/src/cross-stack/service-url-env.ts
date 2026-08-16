import { deterministicEnvelope, REFERENCE_RECEIVER } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * The correspondence that lets a runtime walk start where the traffic starts.
 *
 * The frontend reads `NEWSLETTER_SERVICE_URL`; the deployment assembles that URL in a Terraform
 * service-URL map (`frontend_service_urls = { newsletter = local._agg.newsletter }`) whose entry
 * routes to the process that actually serves the request. Neither file names the other, so without
 * this link every walk from the frontend stops at the environment variable and the aggregator that
 * production runs stays unreachable — the exact shape of the live 503.
 *
 * The rule is dual-sided and refuses ambiguity:
 *
 * 1. The environment variable is URL-shaped: `<STEM>_SERVICE_URL` or `<STEM>_URL`.
 * 2. Exactly ONE service-URL map states an entry whose reference address contains the stem as a
 *    whole segment. Zero maps yield nothing; two maps yield nothing — a guess here would send the
 *    runtime analysis down a path nobody wrote.
 *
 * Provenance is `framework-convention` with evidence from both sides, like every correspondence in
 * this adapter: the convention is real, and a reviewer must be able to open both lines and
 * disagree. Downstream, the runtime walk marks hops crossed via this edge as inferred, so a
 * finding that rests on it can warn but never block.
 */

const URL_ENV_NAME = /^([A-Z0-9]+(?:_[A-Z0-9]+)*?)(?:_SERVICE)?_URL$/;

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** service-url node id → the terraform block node it resolves to. */
const mapBlocksByUrl = (graph: CodeGraph): ReadonlyMap<string, string> => {
  const byUrl = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type === 'RESOLVES_TO' && edge.sourceId.startsWith('service-url:')) {
      byUrl.set(edge.sourceId, edge.targetId);
    }
  }
  return byUrl;
};

interface EntryEvidence {
  readonly urlNodeId: string;
  readonly evidenceId: string;
}

/** Every service-URL map entry, as (stem segment → the map that states it, with its evidence). */
const entrySegments = (graph: CodeGraph): ReadonlyMap<string, readonly EntryEvidence[]> => {
  const blocks = mapBlocksByUrl(graph);
  const urlByBlock = new Map([...blocks].map(([url, block]) => [block, url]));
  const bySegment = new Map<string, EntryEvidence[]>();
  for (const fact of graph.callFacts) {
    if (fact.receiverName !== REFERENCE_RECEIVER || fact.enclosingSymbolNodeId === undefined) {
      continue;
    }
    const urlNodeId = urlByBlock.get(fact.enclosingSymbolNodeId);
    if (urlNodeId === undefined) {
      continue;
    }
    // The entry selector rides identifierArguments (see terraform-graph.ts): `local._agg` is the
    // block the reference resolves to, `newsletter` is the entry the map actually names.
    const address = [fact.calleeName, ...fact.identifierArguments].join('.');
    for (const segment of address.split('.')) {
      const key = normalize(segment);
      if (key.length === 0) {
        continue;
      }
      const existing = bySegment.get(key) ?? [];
      if (!existing.some((entry) => entry.urlNodeId === urlNodeId)) {
        existing.push({ urlNodeId, evidenceId: fact.evidenceId });
      }
      bySegment.set(key, existing);
    }
  }
  return bySegment;
};

const urlShapedEnvNodes = (graph: CodeGraph): readonly { node: GraphNode; stem: string }[] =>
  graph.nodes.flatMap((node) => {
    if (node.type !== 'environment-variable') {
      return [];
    }
    const stem = URL_ENV_NAME.exec(node.name)?.[1];
    return stem === undefined ? [] : [{ node, stem: normalize(stem) }];
  });

export const linkServiceUrlEnvironment = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): void => {
  const segments = entrySegments(graph);
  for (const { node, stem } of urlShapedEnvNodes(graph)) {
    const candidates = segments.get(stem) ?? [];
    if (candidates.length !== 1) {
      continue;
    }
    const target = candidates[0] as EntryEvidence;
    if (target.urlNodeId === String(node.id)) {
      continue;
    }
    builder.addEdge(
      {
        id: `resolves-to:${String(node.id)}->${target.urlNodeId}`,
        type: 'RESOLVES_TO',
        sourceId: String(node.id),
        targetId: target.urlNodeId,
        knowledge: deterministicEnvelope(
          context,
          [...node.knowledge.evidenceIds, target.evidenceId],
          'framework-convention',
        ),
      },
      node.path ?? '',
    );
  }
};
