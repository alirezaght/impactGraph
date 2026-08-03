import { fileNodeId } from '../file-node.js';
import { rangeOfNode } from '../tree-sitter/syntax.js';

import { localSpecifier, referenceAttributeOf } from './reference-targets.js';

import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { Node } from 'web-tree-sitter';

// Story 16.4 — what a standalone `.html` document says about the rest of the system.
//
// PRD §30 is explicit that HTML is read for RELATIONSHIPS, never as application architecture: an
// `.html` file is not a component, declares no routes and owns no behaviour, so this adapter emits
// no symbol nodes at all. Everything it produces hangs off the file node, and it produces exactly
// two kinds of thing:
//
//  * a reference to another file in this repository (`<script src="./app.js">`,
//    `<link href="./styles.css">`) → an ImportReference, which assembly resolves into an IMPORTS
//    edge using the same machinery and the same file roster as every other language;
//  * a reference to somewhere else (`<a href="/deals">`, `<form action="/api/deals">`, a CDN URL)
//    → a fact on the CallFact channel, because whether `/api/deals` is a route of THIS system is a
//    correlation, not something the document states.

/** `receiverName` for a non-file HTML reference: `calleeName` is `<tag>.<attribute>`. */
export const HTML_REFERENCE_RECEIVER = 'html:template';

export interface HtmlState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
}

const MAX_DOCUMENT_NODES = 5000;

const namedChildren = (node: Node): readonly Node[] =>
  node.namedChildren.filter((child): child is Node => child !== null);

const attributesOf = (tag: Node): readonly Node[] =>
  namedChildren(tag).filter((child) => child.type === 'attribute');

const attributeNameOf = (attribute: Node): string | undefined => namedChildren(attribute)[0]?.text;

const attributeValueOf = (attribute: Node): string | undefined => {
  const quoted = namedChildren(attribute).find((child) => child.type === 'quoted_attribute_value');
  return quoted === undefined ? undefined : namedChildren(quoted)[0]?.text;
};

const namedAttributeValue = (tag: Node, name: string): string | undefined => {
  const attribute = attributesOf(tag).find((candidate) => attributeNameOf(candidate) === name);
  return attribute === undefined ? undefined : attributeValueOf(attribute);
};

const evidenceFor = (state: HtmlState, node: Node, symbolName: string): string | undefined => {
  const range = rangeOfNode(node);
  const position = `${String(range.startLine)}:${String(range.startColumn)}`;
  return state.builder.addEvidence(
    {
      id: `ev:call-site:html:${state.filePath}:${position}`,
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

/** `<form method="post">` → POST; see the Astro template reader for why it is normalized. */
const formMethod = (tag: Node, tagName: string): Record<string, string> => {
  const method = tagName === 'form' ? namedAttributeValue(tag, 'method') : undefined;
  return method === undefined || method.trim() === '' ? {} : { method: method.toUpperCase() };
};

interface ReferenceInput {
  readonly tag: Node;
  readonly attribute: Node;
  readonly tagName: string;
  readonly attributeName: string;
  /** Navigation targets are never treated as files, even when they look like one. */
  readonly navigational: boolean;
}

const recordReference = (state: HtmlState, input: ReferenceInput): void => {
  const value = attributeValueOf(input.attribute);
  if (value === undefined || value.trim() === '') {
    return;
  }
  const evidenceId = evidenceFor(state, input.attribute, value);
  if (evidenceId === undefined) {
    return;
  }
  const specifier = input.navigational ? undefined : localSpecifier(value);
  if (specifier !== undefined) {
    state.builder.addImport({
      fromFilePath: state.filePath,
      fromFileNodeId: fileNodeId(state.filePath),
      specifier,
      importedNames: [],
      isReExport: false,
      evidenceId,
    });
    return;
  }
  const keywords = formMethod(input.tag, input.tagName);
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName: HTML_REFERENCE_RECEIVER,
    calleeName: `${input.tagName}.${input.attributeName}`,
    stringArguments: [value],
    identifierArguments: [],
    ...(Object.keys(keywords).length === 0 ? {} : { keywordStringArguments: keywords }),
    evidenceId,
  });
};

const visitTag = (state: HtmlState, tag: Node): void => {
  const tagName = namedChildren(tag)
    .find((child) => child.type === 'tag_name')
    ?.text.toLowerCase();
  if (tagName === undefined) {
    return;
  }
  const target = referenceAttributeOf(tagName);
  if (target === undefined) {
    return;
  }
  for (const attribute of attributesOf(tag)) {
    if (attributeNameOf(attribute) === target.name) {
      recordReference(state, {
        tag,
        attribute,
        tagName,
        attributeName: target.name,
        navigational: target.navigational,
      });
    }
  }
};

const TAG_TYPES = new Set(['start_tag', 'self_closing_tag']);

/**
 * Walk one parsed HTML document, emitting its outbound references in document order — children
 * are pushed reversed so the stack pops them front-to-back. Order is not load-bearing for the
 * graph (goldens sort), but facts that read in the order a person reads the file make an evidence
 * list reviewable.
 */
export const readHtmlDocument = (state: HtmlState, root: Node): void => {
  const stack: Node[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_DOCUMENT_NODES) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visited += 1;
    if (TAG_TYPES.has(node.type)) {
      visitTag(state, node);
    }
    stack.push(...[...namedChildren(node)].reverse());
  }
};
