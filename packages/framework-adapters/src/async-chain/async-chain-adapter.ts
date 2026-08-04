import { FragmentBuilder } from '@impactgraph/language-adapters';

import { linkProjections, linkPushEndpoints } from './delivery-links.js';
import { linkOutbox } from './outbox-links.js';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphFragment } from '@impactgraph/language-adapters';

/**
 * Event-driven chain modelling (item 5, "a major priority": outbox → Pub/Sub → push route →
 * projection).
 *
 * Every hop of that chain already existed in the graph as an unrelated fact — a function that writes
 * a row, a function that publishes, an HTTP route, a function that appends to a list — and nothing
 * joined them. The specification names one end; the analysis reached one file.
 *
 * This adapter joins them from evidence the language adapters already proved, never by re-parsing and
 * never by assuming. Each link has its own rule and its own refusal condition, stated in the module
 * that implements it. Where a hop cannot be resolved, an `unresolved-external-boundary` node is
 * emitted instead of nothing, so a reader can see the chain leaves the indexed scope rather than
 * concluding it ends (items 5, 11).
 */
class AsyncChainAdapter implements FrameworkAdapter {
  public readonly id = 'async-chain';
  public readonly languageIds: readonly string[] = ['typescript', 'python', 'java'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const messaging = graph.nodes.filter((node) =>
      ['topic', 'subscription', 'pubsub-topic', 'pubsub-subscription'].includes(node.type),
    ).length;
    const outboxCalls = graph.callFacts.filter((fact) =>
      /outbox|enqueue|record_event|recordEvent/i.test(fact.calleeName),
    ).length;
    const detected = messaging > 0 || outboxCalls > 0;
    return Promise.resolve({
      detected,
      evidenceIds: [],
      reason: detected
        ? `event-driven facts present: ${String(messaging)} messaging node(s), ${String(outboxCalls)} outbox call(s)`
        : 'no messaging or outbox facts to chain',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    linkOutbox(builder, graph, context.indexing);
    const pushPaths = linkPushEndpoints(builder, graph, context.indexing);
    linkProjections(builder, graph, context.indexing, pushPaths);
    return Promise.resolve(builder.build());
  }
}

export const createAsyncChainAdapter = (): FrameworkAdapter => new AsyncChainAdapter();
