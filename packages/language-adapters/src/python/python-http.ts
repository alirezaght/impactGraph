import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { callSiteEvidence } from './python-context.js';
import { collectClientBindings } from './python-http-bindings.js';
import { ownerNodeId, walkPythonTree } from './python-owner.js';
import { stringLiteralText } from './python-syntax.js';

import type { PythonParseState } from './python-context.js';
import type { ClientBindings } from './python-http-bindings.js';
import type { Node } from 'web-tree-sitter';

// A URL a Python module names through an HTTP client, on the same `http:client` channel the
// TypeScript adapter uses — so the cross-stack adapter cannot tell which language produced it.
//
// WHY THIS IS NARROWER THAN THE TYPESCRIPT EQUIVALENT, and why that narrowness is the honest shape:
//
// `fetch('/api/deals')` in a browser bundle is same-origin BY DEFINITION — the root-relative path
// resolves against the page's own origin, so a matching route in this repository is the route it
// hits. Python has no ambient origin. `client.get('/api/deals')` resolves against the client's
// `base_url`, and a service's `base_url` normally names ANOTHER service. Recording every
// root-relative Python path would therefore link `/api/deals` on `https://payments.example.com`
// to this repository's own `/api/deals` route whenever the two happen to share a path — a
// confident, plausible, wrong edge, which is the one failure this graph must not produce.
//
// So the fact is recorded only when the client is provably bound to an ASGI application object
// that this module hands it:
//
//     client = TestClient(app)                                  # fastapi/starlette test client
//     client = httpx.AsyncClient(app=app)
//     client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app))
//
// In each of those the application is passed in the source, so the origin is not merely unstated
// — it is stated, and it is this repository. What comes out is the genuinely useful relationship
// "this module exercises that route" (PRD §25's coverage question), with none of the guessing.
//
// Deliberately NOT recorded, each for a reason rather than an omission:
// * `httpx.AsyncClient(base_url=…)` / `requests.Session()` — the origin is either stated and
//   external, or an expression this adapter refuses to evaluate (§35). Either way the path names
//   an endpoint of a service this repository does not necessarily declare. The `fastapi-app`
//   fixture contains exactly this shape, pointing at a path the app itself also serves, so a
//   regression that widened the rule would show up as a wrong edge in the golden.
// * An absolute URL anywhere. `normalizeRoutePath` already refuses those downstream; refusing
//   them here as well keeps the fact channel honest instead of relying on a consumer.
// * A non-literal path (`client.get(url)`, an f-string): the path is not stated (§35).
// * `client.request("GET", path)` — the verb sits in an argument rather than in the method name.

/** Shared with the TypeScript adapter; repeated rather than imported, like every channel marker. */
const HTTP_CALL_RECEIVER = 'http:client';

/** A `Map`, not an object literal: keys come from untrusted text and must miss on `constructor`. */
const VERB_METHODS = new Map<string, string>([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
]);

/**
 * A root-relative path the module states literally, or undefined.
 *
 * `//host/x` is protocol-relative — a different origin written to look like a path — and is
 * refused for the same reason an absolute URL is.
 */
const rootRelativePath = (call: Node): string | undefined => {
  const args = fieldNode(call, 'arguments');
  const first = (args === undefined ? [] : namedChildrenOf(args)).find(
    (child) => child.type !== 'keyword_argument',
  );
  const text = first === undefined ? undefined : stringLiteralText(first);
  if (text === undefined || !text.startsWith('/') || text.startsWith('//')) {
    return undefined;
  }
  return text;
};

interface HttpCall {
  readonly calleeName: string;
  readonly path: string;
  readonly method: string;
}

interface VerbCall {
  readonly receiver: string;
  readonly attribute: string;
  readonly method: string;
}

/** `<name>.<verb>(…)` split into its parts, for a verb this library actually has. */
const verbCallOf = (call: Node): VerbCall | undefined => {
  const callee = fieldNode(call, 'function');
  if (callee?.type !== 'attribute') {
    return undefined;
  }
  const receiver = fieldNode(callee, 'object');
  const attribute = fieldNode(callee, 'attribute')?.text;
  const method = attribute === undefined ? undefined : VERB_METHODS.get(attribute);
  return receiver?.type !== 'identifier' || attribute === undefined || method === undefined
    ? undefined
    : { receiver: receiver.text, attribute, method };
};

/** `client.get('/deals/')` where `client` was bound to an app-bound handle, and nothing else. */
const recognize = (bindings: ClientBindings, call: Node): HttpCall | undefined => {
  const verb = verbCallOf(call);
  if (verb === undefined || !bindings.appBoundClients.has(verb.receiver)) {
    return undefined;
  }
  const path = rootRelativePath(call);
  return path === undefined
    ? undefined
    : { calleeName: `${verb.receiver}.${verb.attribute}`, path, method: verb.method };
};

const record = (state: PythonParseState, call: Node, found: HttpCall): void => {
  const evidenceId = callSiteEvidence(state, call, found.calleeName);
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName: HTTP_CALL_RECEIVER,
    calleeName: found.calleeName,
    stringArguments: [found.path],
    identifierArguments: [],
    keywordStringArguments: { method: found.method },
    enclosingSymbolNodeId: ownerNodeId(state, call),
    evidenceId,
  });
};

/**
 * URL facts for one already-parsed module. A module that binds no app-bound client is untouched,
 * so no existing fixture moves and nothing about ordinary outbound HTTP is claimed.
 */
export const collectHttpCallFacts = (state: PythonParseState, root: Node): void => {
  const bindings = collectClientBindings(root);
  if (bindings.appBoundClients.size === 0) {
    return;
  }
  walkPythonTree(root, (node) => {
    const found = node.type === 'call' ? recognize(bindings, node) : undefined;
    if (found !== undefined) {
      record(state, node, found);
    }
  });
};
