import { fileNodeId } from '../file-node.js';
import { deterministicEnvelope } from '../fragment-builder.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { annotationsOf, collectAnnotations } from './java-annotations.js';
import { collectBodyCalls } from './java-calls.js';
import { declarationEvidence } from './java-context.js';
import { pubSubClassScope } from './java-pubsub-class-scope.js';
import { handleScopeOf, importsPubSubClient } from './java-pubsub-resources.js';
import { collectPubSubBodyFacts, detectionFor } from './java-pubsub.js';
import { collectConstructorInjections, collectHeritage } from './java-references.js';
import {
  fieldInitialiserScope,
  fieldTypesOf,
  methodScope,
  recordFieldTypes,
} from './java-types.js';

import type { JavaParseState } from './java-context.js';
import type { JavaPubSubClassScope } from './java-pubsub-class-scope.js';
import type { JavaFieldBindings } from './java-types.js';
import type { Node } from 'web-tree-sitter';

// Java declarations → PRD §12.1 nodes: `class`, `interface`, `method`, plus a `symbol` for a
// field. An enum is a class on the JVM and §12.1 has no separate enum type, so it is reported as
// a `class` — inventing a node type outside §12 is not the adapter's call to make.

interface SymbolNodeOptions {
  readonly nodeId: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly evidenceId: string;
  readonly containerId: string;
}

const addSymbolNode = (state: JavaParseState, options: SymbolNodeOptions): void => {
  const { builder, context, filePath } = state;
  const knowledge = deterministicEnvelope(context, [options.evidenceId], 'static-analysis');
  const node = builder.addNode(
    {
      id: options.nodeId,
      category: options.category,
      type: options.type,
      name: options.name,
      path: filePath,
      knowledge,
    },
    filePath,
  );
  if (node === undefined) {
    return;
  }
  builder.addEdge(
    {
      id: `contains:${options.nodeId}`,
      type: 'CONTAINS',
      sourceId: options.containerId,
      targetId: options.nodeId,
      knowledge,
    },
    filePath,
  );
};

/** The declaring type a member belongs to, and the field types every member can see. */
interface Owner {
  readonly typeName: string;
  readonly nodeId: string;
  readonly fieldTypes: JavaFieldBindings;
  /**
   * What this class body states about Pub/Sub, read once before any member — undefined when the
   * file imports no client library, which is the gate that keeps every other fixture untouched.
   * Class-scoped by construction, so two classes in one file can never resolve each other's fields.
   */
  readonly pubsub: JavaPubSubClassScope | undefined;
}

const addMethod = (state: JavaParseState, declaration: Node, owner: Owner): void => {
  const name = fieldNode(declaration, 'name')?.text;
  if (name === undefined) {
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${owner.typeName}.${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'method',
    name: `${owner.typeName}.${name}`,
    evidenceId,
    containerId: owner.nodeId,
  });
  collectAnnotations(state, annotationsOf(declaration), nodeId);
  const body = fieldNode(declaration, 'body');
  if (body !== undefined) {
    const scope = methodScope(owner.fieldTypes, declaration);
    collectBodyCalls(state, body, nodeId, scope);
    // Story 16.3: derived from the tree this pass already has, and gated on an import of a real
    // Pub/Sub client — a file that uses none is untouched, so no existing fixture moves.
    if (owner.pubsub !== undefined) {
      const detection = detectionFor(state, scope, owner.pubsub, handleScopeOf(state, body));
      collectPubSubBodyFacts(detection, body, nodeId);
    }
  }
};

/**
 * `private final Publisher p = Publisher.newBuilder(…).build();` — the initialiser is a body like
 * any other, and its facts hang off the FIELD's own symbol node, which is the declaration that
 * contains the call. The scope it sees is the class's fields alone (epic-16).
 */
const collectFieldInitialiserFacts = (
  state: JavaParseState,
  declarator: Node,
  owner: Owner,
  nodeId: string,
): void => {
  const value = fieldNode(declarator, 'value');
  if (owner.pubsub === undefined || value === undefined) {
    return;
  }
  const scope = fieldInitialiserScope(owner.fieldTypes);
  collectPubSubBodyFacts(detectionFor(state, scope, owner.pubsub, new Map()), value, nodeId);
};

/** `private final DealService dealService;` — one field node per declarator. */
const addField = (state: JavaParseState, declaration: Node, owner: Owner): void => {
  recordFieldTypes(state, declaration, owner.nodeId);
  for (const declarator of namedChildrenOf(declaration)) {
    if (declarator.type !== 'variable_declarator') {
      continue;
    }
    const name = fieldNode(declarator, 'name')?.text;
    const evidenceId =
      name === undefined ? undefined : declarationEvidence(state, declarator, name);
    if (name === undefined || evidenceId === undefined) {
      continue;
    }
    const nodeId = `symbol:${state.filePath}#${owner.typeName}.${name}`;
    addSymbolNode(state, {
      nodeId,
      category: 'repository',
      type: 'symbol',
      name: `${owner.typeName}.${name}`,
      evidenceId,
      containerId: owner.nodeId,
    });
    // Field annotations are facts like any other (`@Autowired`, `@Column`, `@Value`); what they
    // mean is a framework adapter's reading, and without them field injection is invisible.
    collectAnnotations(state, annotationsOf(declaration), nodeId);
    collectFieldInitialiserFacts(state, declarator, owner, nodeId);
  }
};

const addConstructor = (state: JavaParseState, declaration: Node, owner: Owner): void => {
  collectConstructorInjections(state, declaration, owner.nodeId);
  addMethod(state, declaration, owner);
};

const MEMBER_HANDLERS: Readonly<
  Record<string, (state: JavaParseState, member: Node, owner: Owner) => void>
> = {
  method_declaration: addMethod,
  constructor_declaration: addConstructor,
  field_declaration: addField,
};

const addMembers = (state: JavaParseState, body: Node, owner: Owner): void => {
  for (const member of namedChildrenOf(body)) {
    // An enum body wraps its methods in `enum_body_declarations`.
    const entries = member.type === 'enum_body_declarations' ? namedChildrenOf(member) : [member];
    for (const entry of entries) {
      MEMBER_HANDLERS[entry.type]?.(state, entry, owner);
    }
  }
};

const NODE_TYPE_BY_DECLARATION: Readonly<Record<string, string>> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'class',
  record_declaration: 'class',
  annotation_type_declaration: 'interface',
};

export const isTypeDeclaration = (node: Node): boolean => node.type in NODE_TYPE_BY_DECLARATION;

/** One top-level (or nested) type declaration and everything it contains. */
export const addTypeDeclaration = (state: JavaParseState, declaration: Node): void => {
  const type = NODE_TYPE_BY_DECLARATION[declaration.type];
  const name = fieldNode(declaration, 'name')?.text;
  if (type === undefined || name === undefined) {
    state.builder.warn(state.filePath, 'type declaration without a name — skipped');
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type,
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
  });
  // Java resolves a type by its simple name from any file that imports or shares its package,
  // so every declared type is importable — there is no `export` keyword to consult.
  state.builder.addExport(state.filePath, { name, nodeId });
  collectAnnotations(state, annotationsOf(declaration), nodeId);
  collectHeritage(state, declaration, nodeId);
  const body = fieldNode(declaration, 'body');
  if (body !== undefined) {
    // Fields are read before members so a method declared above a field still sees its type — and,
    // for the same reason, so a field initialiser sees a `TopicName` field declared below it.
    addMembers(state, body, {
      typeName: name,
      nodeId,
      fieldTypes: fieldTypesOf(body),
      pubsub: importsPubSubClient(state) ? pubSubClassScope(state, body) : undefined,
    });
  }
};
