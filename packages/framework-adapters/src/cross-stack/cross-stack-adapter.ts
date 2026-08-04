import { FragmentBuilder } from '@impactgraph/language-adapters';

import { linkCloudRunEnvironment } from './cloud-run-env.js';
import {
  CORRELATABLE_CODE_TYPES,
  CORRELATABLE_INFRA_TYPES,
  linkInfrastructure,
} from './infrastructure-links.js';
import { linkLocaleKeys, linkOpenApiOperations } from './locale-links.js';
import { linkOutboundHttp } from './outbound-http.js';
import { linkPageNavigation } from './page-links.js';
import { linkTemplateReferences, referenceSourceId } from './template-calls.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

// Story 16.6 — cross-stack relationship detection (PRD §C13, §C12).
//
// This adapter is what turns four independent adapters into one architectural system. It runs LAST
// in the framework roster, because the nodes it correlates (`route:<VERB> <path>`, topics,
// Terraform resources) are themselves produced by the adapters before it — see the per-adapter
// graph view in repository-intelligence's `framework-enrichment.ts`.
//
// It never re-parses anything and never reads a file. It only correlates facts other adapters
// already proved, and everything it emits carries `framework-convention` provenance with evidence
// from both sides of the correspondence, so nothing here can be mistaken for a parsed fact.
//
// All three application languages now produce Pub/Sub client facts — TypeScript
// (`@google-cloud/pubsub`), Python (`google.cloud.pubsub_v1`) and Java/Spring (`PubSubTemplate`,
// `PubSubInboundChannelAdapter`, the native `Publisher`/`Subscriber` builders). They agree on
// `topic:<name>` / `subscription:<name>` node ids, so this adapter correlates them with the
// Terraform resources through exactly the same path, and CANNOT tell which language produced a
// node. That is the requirement, not an implementation detail (§C13).
//
// Deliberately NOT implemented, rather than approximated (PRD §34 — partial support is reported):
//
// * A Pub/Sub name the repository states NOWHERE — a function parameter, a runtime-computed
//   string. `process.env.X` is no longer in this list: `cloud-run-env.ts` resolves it when, and
//   only when, the Terraform sets that exact variable to a literally-named topic on a service this
//   code is deployed as. When it does not, nothing is emitted, which is the same outcome as before.
// * Cloud Run container image → application. The image is almost always an interpolated string,
//   and deriving an application name from a registry path is guesswork about a value we do not
//   control. The declared service `name` is used instead, which the configuration states outright.
// * FastAPI → PostgreSQL (§C13): no adapter produces database nodes yet, so there is nothing on
//   the other side of the correspondence to match.
//
// `<a href>` → `page:` navigation IS now emitted (see `page-links.ts`) — the earlier reasoning
// ("intra-app navigation, not a cross-boundary call") measured stack boundaries when what makes a
// relationship architectural is whether the repository states it and whether changing one end
// affects the other. A page link states both.

/** Both URL channels: Astro template attributes, and `fetch('<literal>')` in TypeScript. */
const URL_RECEIVERS = new Set(['astro:template', 'html:template', 'http:client']);

const hasUrlReferences = (graph: CodeGraph): boolean =>
  graph.callFacts.some(
    (fact) => fact.receiverName !== undefined && URL_RECEIVERS.has(fact.receiverName),
  );

const countByType = (graph: CodeGraph, types: ReadonlySet<string>): number =>
  graph.nodes.filter((node) => types.has(node.type)).length;

/**
 * Report the one gap that silently costs edges: infrastructure topics exist, and nothing on the
 * code side produces an integration node to match them with (PRD §34).
 *
 * Since Story 16.3 this is no longer "not implemented" — it is "detected nothing", which has two
 * very different causes the reader must be able to tell apart, so the warning names the client
 * shapes that ARE covered instead of claiming a missing feature.
 */
const COVERED_CLIENTS =
  '@google-cloud/pubsub (TypeScript), google.cloud.pubsub_v1 (Python) and Spring Cloud GCP / ' +
  'com.google.cloud.pubsub.v1 (Java)';

const warnOnMissingClientFacts = (builder: FragmentBuilder, graph: CodeGraph): void => {
  const topics = graph.nodes.filter(
    (node) => node.type === 'pubsub-topic' || node.type === 'pubsub-subscription',
  ).length;
  const integration = graph.nodes.filter(
    (node) => node.type === 'topic' || node.type === 'subscription',
  ).length;
  if (topics > 0 && integration === 0) {
    builder.warn(
      'cross-stack',
      `Terraform declares ${String(topics)} Pub/Sub resource(s) but no code-side publisher or ` +
        'consumer was detected — either nothing in this repository uses them, or the client usage ' +
        `is a shape no adapter covers (covered: ${COVERED_CLIENTS})`,
    );
  }
};

class CrossStackAdapter implements FrameworkAdapter {
  public readonly id = 'cross-stack';
  public readonly languageIds: readonly string[] = [
    'typescript',
    'python',
    'java',
    'astro',
    'terraform',
  ];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const routes = countByType(graph, new Set(['api-endpoint']));
    const infrastructure = countByType(graph, CORRELATABLE_INFRA_TYPES);
    const code = countByType(graph, CORRELATABLE_CODE_TYPES);
    const assets = countByType(graph, new Set(['translation-key', 'openapi-operation']));
    const pairs = {
      // `hasUrlReferences` alone no longer decides: an outbound absolute-URL call is correlatable
      // even with no route in this workspace, because the boundary itself is worth modelling.
      http: hasUrlReferences(graph) && (routes > 0 || code > 0),
      infrastructure: infrastructure > 0 && code > 0,
      // Item 8: assets alongside code is a correlatable pair too — a locale key and the renderer
      // that names it are two stacks in every sense that matters here.
      asset: assets > 0 && (code > 0 || routes > 0),
    };
    return Promise.resolve({
      detected: Object.values(pairs).some(Boolean),
      evidenceIds: [],
      reason: this.reasonFor(pairs),
    });
  }

  private reasonFor(pairs: Readonly<Record<string, boolean>>): string {
    const labels: Readonly<Record<string, string>> = {
      http: 'URL references alongside declared HTTP routes',
      infrastructure: 'infrastructure resources alongside application components',
      asset: 'locale keys or contract operations alongside application components',
    };
    const found = Object.entries(pairs)
      .filter(([, present]) => present)
      .map(([key]) => labels[key] ?? key);
    return found.length > 0
      ? `correlatable across stacks: ${found.join('; ')}`
      : 'no two stacks with correlatable facts found';
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    linkTemplateReferences(builder, graph, context.indexing);
    linkPageNavigation({
      builder,
      graph,
      context: context.indexing,
      sourceIdOf: (fact) => referenceSourceId(graph, fact),
    });
    const deployments = linkInfrastructure(builder, graph, context.indexing);
    linkCloudRunEnvironment(builder, graph, context.indexing, deployments);
    // Item 8: the two asset correspondences. Both are literal-key joins on ids the asset adapter and
    // the framework adapters independently agree on, so neither side knows about the other.
    linkLocaleKeys(builder, graph, context.indexing);
    linkOpenApiOperations(builder, graph, context.indexing);
    // Item 6: an absolute-URL call to a sibling service. Matched by PATH when the route is in this
    // workspace, recorded as an unresolved boundary when it is not — never silently dropped.
    linkOutboundHttp(builder, graph, context.indexing);
    warnOnMissingClientFacts(builder, graph);
    return Promise.resolve(builder.build());
  }
}

export const createCrossStackAdapter = (): FrameworkAdapter => new CrossStackAdapter();
