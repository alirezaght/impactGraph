import { fileNodeId } from '../file-node.js';
import { localSpecifier, referenceAttributeOf } from '../html/reference-targets.js';
import { rangeOfNode } from '../tree-sitter/syntax.js';

import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { Node } from 'web-tree-sitter';

// The template half of an `.astro` file, read with the `html` grammar (ADR-0014). PRD §30 keeps
// HTML relationship-focused: which components a template renders, and which routes, scripts and
// assets it points at. It is never treated as application architecture in its own right.
//
// Which attribute of which tag points where — and whether the target is a file or a place to go —
// is defined once in `../html/reference-targets.ts` and shared with the standalone `.html`
// adapter. It used to be duplicated here, the two copies drifted, and the drift is what stopped
// a repository-local `<script src="…">` in an `.astro` file from ever becoming an IMPORTS edge.
//
// Every fact from this half carries an `astro-template:` evidence scope, so a reader can tell at
// a glance which parser produced it without opening the file.

export const TEMPLATE_SCOPE = 'astro-template:';

/** `receiverName` on the CallFacts this module emits — the channel marker for the Astro adapter. */
export const TEMPLATE_REFERENCE_RECEIVER = 'astro:template';

/**
 * `receiverName` for a `client:*` hydration directive: `calleeName` is the directive
 * (`client:load`), `stringArguments[0]` is the component it hydrates.
 *
 * These are recorded as facts and produce NO edge, deliberately. A `client:load` says the
 * component ships to the browser and runs there — a real architectural property, and one PRD §12
 * has no node or edge type for. The relationship that IS expressible (this page renders that
 * component) is already the component reference below, so a second edge would restate it while
 * saying nothing about hydration. Modelling client islands properly needs a §12 addition, which is
 * the domain-provenance agent's decision.
 */
export const CLIENT_DIRECTIVE_RECEIVER = 'astro:client-directive';

export interface TemplateState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
  /** The `.astro` file's own component node — the source of every relationship found here. */
  readonly componentNodeId: string;
}

const evidenceFor = (state: TemplateState, node: Node, symbolName: string): string | undefined => {
  const range = rangeOfNode(node);
  const position = `${String(range.startLine)}:${String(range.startColumn)}`;
  return state.builder.addEvidence(
    {
      id: `ev:call-site:${TEMPLATE_SCOPE}${state.filePath}:${position}`,
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

const namedChildren = (node: Node): readonly Node[] =>
  node.namedChildren.filter((child): child is Node => child !== null);

const attributeValue = (attribute: Node): string | undefined => {
  const quoted = namedChildren(attribute).find((child) => child.type === 'quoted_attribute_value');
  const value = quoted === undefined ? undefined : namedChildren(quoted)[0];
  return value?.text;
};

/** A capitalized tag is a component in every JSX-family template language, Astro included. */
const isComponentTag = (tagName: string): boolean => /^[A-Z]/.test(tagName);

const recordComponentUsage = (state: TemplateState, tag: Node, tagName: string): void => {
  const evidenceId = evidenceFor(state, tag, tagName);
  if (evidenceId === undefined) {
    return;
  }
  // Resolved at assembly against the frontmatter's imports, which is what binds `<Base />` to
  // `src/layouts/Base.astro`. An unimported capitalized tag stays unresolved and is reported.
  state.builder.addSymbolReference({
    kind: 'calls',
    fromSymbolNodeId: state.componentNodeId,
    filePath: state.filePath,
    targetName: tagName,
    evidenceId,
  });
};

const attributesOf = (tag: Node): readonly Node[] =>
  namedChildren(tag).filter((child) => child.type === 'attribute');

const attributeNameOf = (attribute: Node): string | undefined => namedChildren(attribute)[0]?.text;

const namedAttributeValue = (tag: Node, name: string): string | undefined => {
  const attribute = attributesOf(tag).find((candidate) => attributeNameOf(candidate) === name);
  return attribute === undefined ? undefined : attributeValue(attribute);
};

/**
 * The verb a `<form>` declares (Story 16.6). Recorded so a route correlation can be verb-exact
 * instead of matching every verb declared at the path.
 *
 * Uppercased because HTTP method tokens are case-insensitive (RFC 9110) while route nodes spell
 * them uppercase; that is a normalization, not an interpretation. An ABSENT `method` records
 * nothing: HTML's default is GET, but applying a default is the correlating adapter's decision,
 * and this channel records what the document says.
 */
const declaredFormMethod = (tag: Node, tagName: string): Record<string, string> => {
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

/**
 * A repository-local asset reference, recorded exactly as the standalone `.html` adapter records
 * it (epic-16 — the two readers were divergent, and the divergence cost `IMPORTS` edges).
 *
 * `<script src="../scripts/x.ts">` is the unambiguous case: Astro bundles it and resolves the
 * specifier relative to THIS FILE. For the other asset attributes a plain relative URL is left for
 * the browser, which resolves it against the page URL rather than the source file — so the claim
 * made here is the narrower one the document actually states, "this file names that path", and it
 * only becomes an edge when a scanned file sits at it. An unmatched specifier resolves to nothing.
 */
const recordAssetImport = (state: TemplateState, specifier: string, evidenceId: string): void => {
  state.builder.addImport({
    fromFilePath: state.filePath,
    fromFileNodeId: fileNodeId(state.filePath),
    specifier,
    importedNames: [],
    isReExport: false,
    evidenceId,
  });
};

const recordReference = (state: TemplateState, input: ReferenceInput): void => {
  const value = attributeValue(input.attribute);
  if (value === undefined || value.trim() === '') {
    return;
  }
  const evidenceId = evidenceFor(state, input.attribute, value);
  if (evidenceId === undefined) {
    return;
  }
  const specifier = input.navigational ? undefined : localSpecifier(value);
  if (specifier !== undefined) {
    recordAssetImport(state, specifier, evidenceId);
    return;
  }
  const keywords = declaredFormMethod(input.tag, input.tagName);
  // Everything else travels on the CallFact channel — the language-neutral "raw material for
  // framework adapters" bus (PRD §31). Correlating `/api/deals` with a route is the Astro
  // framework adapter's job, not the parser's.
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName: TEMPLATE_REFERENCE_RECEIVER,
    calleeName: `${input.tagName}.${input.attributeName}`,
    stringArguments: [value],
    identifierArguments: [],
    ...(Object.keys(keywords).length === 0 ? {} : { keywordStringArguments: keywords }),
    evidenceId,
  });
};

const CLIENT_DIRECTIVE = /^client:/;

/** `<Counter client:visible />` — recorded verbatim; see CLIENT_DIRECTIVE_RECEIVER. */
const recordClientDirectives = (state: TemplateState, tag: Node, tagName: string): void => {
  for (const attribute of attributesOf(tag)) {
    const name = attributeNameOf(attribute);
    const evidenceId =
      name !== undefined && CLIENT_DIRECTIVE.test(name)
        ? evidenceFor(state, attribute, name)
        : undefined;
    if (name === undefined || evidenceId === undefined) {
      continue;
    }
    state.builder.addCallFact({
      filePath: state.filePath,
      receiverName: CLIENT_DIRECTIVE_RECEIVER,
      calleeName: name,
      stringArguments: [tagName],
      identifierArguments: [],
      evidenceId,
    });
  }
};

const visitTag = (state: TemplateState, tag: Node): void => {
  const tagNameNode = namedChildren(tag).find((child) => child.type === 'tag_name');
  const tagName = tagNameNode?.text;
  if (tagName === undefined) {
    return;
  }
  if (isComponentTag(tagName)) {
    recordComponentUsage(state, tag, tagName);
    recordClientDirectives(state, tag, tagName);
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
        tagName: tagName.toLowerCase(),
        attributeName: target.name,
        navigational: target.navigational,
      });
    }
  }
};

const TAG_TYPES = new Set(['start_tag', 'self_closing_tag']);

const MAX_TEMPLATE_NODES = 5000;

/**
 * Walk one parsed template, emitting its component usages and outbound references in DOCUMENT
 * order — children are pushed reversed so the stack pops them front-to-back, the same as the
 * `.html` reader. Order is not load-bearing for the graph (goldens sort), but facts that read in
 * the order a person reads the file make an evidence list reviewable.
 */
export const readAstroTemplate = (state: TemplateState, root: Node): void => {
  const stack: Node[] = [root];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_TEMPLATE_NODES) {
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
