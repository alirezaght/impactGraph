import { deterministicEnvelope } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

/**
 * Locale keys ↔ the code that renders them (item 8: "Connect locale keys to code usages and
 * rendering paths when possible").
 *
 * This is the correspondence that made the trial's notification case unanalysable. A specification
 * says "the subject line must name the buyer"; the subject line lives in `de.json` under
 * `nda.signature_request.subject`; the renderer calls `t('nda.signature_request.subject')`. Both
 * halves were in the repository and neither knew about the other, so a change that was half
 * translation work reached nothing.
 *
 * The join is a LITERAL STRING MATCH between a translation function's argument and an indexed key.
 * That is deliberately narrow, and it is why the edge can be deterministic: no inference, no
 * similarity, no guessing at a computed key. A key assembled at runtime
 * (`t(\`nda.\${kind}.subject\`)`) is not matched, and saying so is better than matching a prefix and
 * hoping (PRD §34).
 */

/** Call names that mean "render this translation key" in the ecosystems we index. */
const TRANSLATION_CALLEES = new Set([
  't',
  '$t',
  'translate',
  'i18n',
  'gettext',
  '_',
  'formatMessage',
  'getMessage',
  'tr',
]);

/** Receivers whose method calls are translations: `i18n.t(...)`, `intl.formatMessage(...)`. */
const TRANSLATION_RECEIVERS = new Set(['i18n', 'intl', 't', 'translator', 'messages', 'i18next']);

const isTranslationCall = (calleeName: string, receiverName: string | undefined): boolean =>
  TRANSLATION_CALLEES.has(calleeName) ||
  (receiverName !== undefined && TRANSLATION_RECEIVERS.has(receiverName));

/**
 * Link every code site that names an indexed translation key.
 *
 * One key may be defined in several bundles (`de.json`, `en.json`); the renderer renders the KEY, so
 * an edge is emitted to each bundle's node. That is not duplication — a change to the rendered text
 * genuinely has to happen in every locale, which is precisely the artifact the trials said went
 * missing.
 */
export const linkLocaleKeys = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): number => {
  const keyNodesByName = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.type === 'translation-key') {
      const existing = keyNodesByName.get(node.name) ?? [];
      existing.push(node.id);
      keyNodesByName.set(node.name, existing);
    }
  }
  if (keyNodesByName.size === 0) {
    return 0;
  }
  let linked = 0;
  for (const fact of graph.callFacts) {
    if (isTranslationCall(fact.calleeName, fact.receiverName)) {
      linked += linkOneCall(builder, context, fact, keyNodesByName);
    }
  }
  return linked;
};

const linkOneCall = (
  builder: FragmentBuilder,
  context: IndexingContext,
  fact: CallFact,
  keyNodesByName: ReadonlyMap<string, readonly string[]>,
): number => {
  const sourceId = fact.enclosingSymbolNodeId ?? `file:${fact.filePath}`;
  const targets = fact.stringArguments.flatMap((argument) => keyNodesByName.get(argument) ?? []);
  let linked = 0;
  for (const targetId of targets) {
    const edge = builder.addEdge(
      {
        id: `edge:renders-key:${sourceId}->${targetId}`,
        type: 'RENDERS_KEY',
        sourceId,
        targetId,
        knowledge: deterministicEnvelope(context, [fact.evidenceId], 'framework-convention'),
      },
      fact.filePath,
    );
    if (edge !== undefined) {
      linked += 1;
    }
  }
  return linked;
};

/**
 * OpenAPI operations ↔ the routes that implement them (items 6, 8).
 *
 * Both sides are already keyed by `<VERB> <path>`: the asset adapter emits
 * `operation:GET /api/deals` and the framework adapters emit `route:GET /api/deals`. Matching them
 * turns a declared contract into the other side of an implementation, which is what makes "changing
 * this endpoint changes that contract document" a fact rather than a convention someone remembers.
 */
export const linkOpenApiOperations = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  context: IndexingContext,
): number => {
  const routesByLabel = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type === 'api-endpoint') {
      routesByLabel.set(node.name, node.id);
    }
  }
  let linked = 0;
  for (const node of graph.nodes) {
    if (node.type !== 'openapi-operation') {
      continue;
    }
    // The node's NAME may be an operationId, so the label is rebuilt from the id, which is always
    // `operation:<VERB> <path>`.
    const label = node.id.startsWith('operation:') ? node.id.slice('operation:'.length) : node.name;
    const routeId = routesByLabel.get(label);
    if (routeId === undefined) {
      continue;
    }
    const edge = builder.addEdge(
      {
        id: `edge:implements-operation:${routeId}->${node.id}`,
        type: 'IMPLEMENTS_OPERATION',
        sourceId: routeId,
        targetId: node.id,
        knowledge: deterministicEnvelope(
          context,
          [...node.knowledge.evidenceIds],
          'framework-convention',
        ),
      },
      node.path ?? 'cross-stack',
    );
    if (edge !== undefined) {
      linked += 1;
    }
  }
  return linked;
};
