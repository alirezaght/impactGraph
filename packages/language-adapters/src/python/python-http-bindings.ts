import { fieldNode, fieldNodes, namedChildrenOf } from '../tree-sitter/syntax.js';

import { walkPythonTree } from './python-owner.js';
import { dottedName } from './python-syntax.js';

import type { Node } from 'web-tree-sitter';

// Which local names in one Python module are an HTTP client bound to an ASGI application declared
// in this repository. The same discipline as `typescript/pubsub-bindings.ts`: **the import proves
// the identity**, and a name that no import ties to a real client library never matches, however
// suggestively it is spelled.
//
// Two things must BOTH be true for a name to bind here:
//
//  1. the constructor comes from a client library this module imports — `TestClient` from
//     `fastapi.testclient`/`starlette.testclient`, or `AsyncClient`/`Client`/`ASGITransport` from
//     `httpx`; and
//  2. the construction is handed an application object — `TestClient(app)` (whose first
//     positional parameter IS the app, by that constructor's contract), an `app=` keyword, or a
//     `transport=` naming an `ASGITransport` that itself was handed one.
//
// A local `SomeWrapper(app=app)` satisfies (2) and fails (1), so it binds nothing. That is the
// point: `app=` alone proves someone passed something named `app`, not that an HTTP client is
// involved.

const TEST_CLIENT_MODULES = new Set(['fastapi.testclient', 'starlette.testclient']);
const TEST_CLIENT_EXPORT = 'TestClient';

const HTTPX_MODULE = 'httpx';
const HTTPX_CLIENTS = new Set(['AsyncClient', 'Client']);
const ASGI_TRANSPORT = 'ASGITransport';

const APP_KEYWORD = 'app';
const TRANSPORT_KEYWORD = 'transport';

export interface ClientBindings {
  /** Local names that construct a client running requests against an ASGI app. */
  readonly appBoundClients: ReadonlySet<string>;
}

interface Imports {
  /** Local names bound to a real `TestClient`. */
  readonly testClients: Set<string>;
  /** Local names bound to `httpx.AsyncClient`/`Client`, imported directly. */
  readonly httpxClients: Set<string>;
  /** Local names bound to `httpx.ASGITransport`, imported directly. */
  readonly transports: Set<string>;
  /** True when the module imports httpx as a module, enabling `httpx.AsyncClient(…)`. */
  httpxModule: boolean;
}

/** `import x.y as z` / `from m import a as b` — the LOCAL name and the name it came from. */
interface Binding {
  readonly local: string;
  readonly exported: string;
}

const bindingsOf = (statement: Node): readonly Binding[] =>
  fieldNodes(statement, 'name').map((name) => {
    if (name.type !== 'aliased_import') {
      const text = name.text;
      return { local: text.split('.')[0] ?? text, exported: text };
    }
    const children = namedChildrenOf(name);
    return { local: children[1]?.text ?? name.text, exported: children[0]?.text ?? '' };
  });

const readFromImport = (into: Imports, statement: Node): void => {
  const module = fieldNode(statement, 'module_name')?.text ?? '';
  for (const binding of bindingsOf(statement)) {
    if (TEST_CLIENT_MODULES.has(module) && binding.exported === TEST_CLIENT_EXPORT) {
      into.testClients.add(binding.local);
    }
    if (module !== HTTPX_MODULE) {
      continue;
    }
    if (HTTPX_CLIENTS.has(binding.exported)) {
      into.httpxClients.add(binding.local);
    }
    if (binding.exported === ASGI_TRANSPORT) {
      into.transports.add(binding.local);
    }
  }
};

const collectImports = (root: Node): Imports => {
  const into: Imports = {
    testClients: new Set(),
    httpxClients: new Set(),
    transports: new Set(),
    httpxModule: false,
  };
  for (const statement of namedChildrenOf(root)) {
    if (statement.type === 'import_from_statement') {
      readFromImport(into, statement);
    } else if (statement.type === 'import_statement') {
      into.httpxModule ||= bindingsOf(statement).some(
        (binding) => binding.exported === HTTPX_MODULE,
      );
    }
  }
  return into;
};

/** What a callee names, split into `httpx` (or nothing) and the trailing attribute. */
interface Callee {
  readonly qualifier?: string;
  readonly tail: string;
}

const calleeOf = (call: Node): Callee | undefined => {
  const callee = fieldNode(call, 'function');
  const dotted = callee === undefined ? undefined : dottedName(callee);
  if (dotted === undefined) {
    return undefined;
  }
  const dot = dotted.lastIndexOf('.');
  return dot < 0
    ? { tail: dotted }
    : { qualifier: dotted.slice(0, dot), tail: dotted.slice(dot + 1) };
};

const isHttpxCall = (imports: Imports, callee: Callee, names: ReadonlySet<string>): boolean => {
  if (callee.qualifier === undefined) {
    return names.has(callee.tail);
  }
  return (
    imports.httpxModule &&
    callee.qualifier === HTTPX_MODULE &&
    (names.has(callee.tail) || HTTPX_CLIENTS.has(callee.tail) || callee.tail === ASGI_TRANSPORT)
  );
};

const positionalCount = (call: Node): number => {
  const args = fieldNode(call, 'arguments');
  return (args === undefined ? [] : namedChildrenOf(args)).filter(
    (child) => child.type !== 'keyword_argument',
  ).length;
};

interface KeywordScan {
  readonly hasApp: boolean;
  readonly transport?: Node;
}

/** `name=value` of one argument node, or nothing when it is positional. */
const keywordPair = (argument: Node): { name: string; value: Node } | undefined => {
  const name = argument.type === 'keyword_argument' ? fieldNode(argument, 'name')?.text : undefined;
  const value = name === undefined ? undefined : fieldNode(argument, 'value');
  return name === undefined || value === undefined ? undefined : { name, value };
};

const keywordsOf = (call: Node): KeywordScan => {
  const args = fieldNode(call, 'arguments');
  let hasApp = false;
  let transport: Node | undefined;
  for (const argument of args === undefined ? [] : namedChildrenOf(args)) {
    const pair = keywordPair(argument);
    hasApp ||= pair?.name === APP_KEYWORD;
    transport = pair?.name === TRANSPORT_KEYWORD ? pair.value : transport;
  }
  return transport === undefined ? { hasApp } : { hasApp, transport };
};

/** `httpx.ASGITransport(app=app)`, inline or through a name already bound to one. */
const isAppTransport = (imports: Imports, bound: ReadonlySet<string>, value: Node): boolean => {
  if (value.type === 'identifier') {
    return bound.has(value.text);
  }
  const callee = value.type === 'call' ? calleeOf(value) : undefined;
  if (callee === undefined || !isHttpxCall(imports, callee, imports.transports)) {
    return false;
  }
  return callee.tail === ASGI_TRANSPORT && keywordsOf(value).hasApp;
};

const httpxClientBindsApp = (
  imports: Imports,
  transports: ReadonlySet<string>,
  call: Node,
): boolean => {
  const keywords = keywordsOf(call);
  return (
    keywords.hasApp ||
    (keywords.transport !== undefined && isAppTransport(imports, transports, keywords.transport))
  );
};

/** Does this call construct a client that talks to an ASGI application handed to it here? */
const bindsApp = (imports: Imports, transports: ReadonlySet<string>, call: Node): boolean => {
  const callee = calleeOf(call);
  if (callee === undefined) {
    return false;
  }
  // `TestClient(app)` takes the application as its first positional parameter — that is the
  // constructor's own contract, so a value in that position IS the app.
  if (callee.qualifier === undefined && imports.testClients.has(callee.tail)) {
    return positionalCount(call) > 0 || keywordsOf(call).hasApp;
  }
  const isClient =
    HTTPX_CLIENTS.has(callee.tail) && isHttpxCall(imports, callee, imports.httpxClients);
  return isClient && httpxClientBindsApp(imports, transports, call);
};

/**
 * Every local name in this module bound to an app-bound HTTP client.
 *
 * Transports are resolved in the same source-order pass, so `transport = ASGITransport(app=app)`
 * above `client = httpx.AsyncClient(transport=transport)` binds both.
 */
export const collectClientBindings = (root: Node): ClientBindings => {
  const imports = collectImports(root);
  const boundTransports = new Set<string>();
  const appBoundClients = new Set<string>();
  if (imports.testClients.size === 0 && imports.httpxClients.size === 0 && !imports.httpxModule) {
    return { appBoundClients };
  }
  walkPythonTree(root, (node) => {
    const target = node.type === 'assignment' ? fieldNode(node, 'left') : undefined;
    const value = target?.type === 'identifier' ? fieldNode(node, 'right') : undefined;
    if (target === undefined || value?.type !== 'call') {
      return;
    }
    if (isAppTransport(imports, boundTransports, value)) {
      boundTransports.add(target.text);
    }
    if (bindsApp(imports, boundTransports, value)) {
      appBoundClients.add(target.text);
    }
  });
  return { appBoundClients };
};
