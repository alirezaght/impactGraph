import ts from 'typescript';

import { AXIOS_VERB_METHODS, GLOBAL_CALLABLES, httpClientBindings } from './http-clients.js';
import { evidenceIdFor, rangeOf } from './parse-context.js';
import { ownerNodeId } from './parse-owner.js';

import type { HttpClientBindings } from './http-clients.js';
import type { ParseState } from './parse-context.js';

// Epic-16 Story 16.6: a URL a TypeScript file literally names, recorded on the existing `CallFact`
// channel under its own receiver marker so nothing else can mistake it for a method call on a
// variable named `http:client`.
//
// The marker convention mirrors `astro:template` and `terraform:reference`: a receiver name that
// cannot be a JavaScript identifier, so no call-convention adapter (Express, Astro collections,
// §Z8 rules) can ever match it by accident.
//
// WHICH CALLEES COUNT is decided in `http-clients.ts`, from the file's imports. `fetch` is the
// global exception — it needs no import, and in a browser a root-relative `fetch` URL is
// same-origin by definition. Everything else must be import-bound: `axios` from 'axios', an
// `axios.create()` instance of it, `$fetch`/`ofetch` from 'ofetch'. A wrapped client
// (`apiClient.get(…)` over a local module) stays undetected and is documented as such — the
// import proves where the name came from, not that the module behind it speaks HTTP.
//
// Narrow on purpose, unchanged from the first pass:
// * The URL must be a plain string literal. A template literal with a hole (`/api/${id}`) states a
//   shape, not a path, and correlating a shape would be the similarity matching §C13 forbids.
// * The VERB is recorded only when it is stated literally — by the method name (`axios.post`) or
//   by a literal `method` in the options object. A computed or absent verb records nothing, and
//   the reference then names a path rather than one endpoint.
//
// This emits no node and no edge: correlating a URL with a route is the cross-stack adapter's job
// and carries `framework-convention` there. What the language adapter contributes is the parsed
// fact that this file names this URL, which is plain `static-analysis`.

/**
 * Not a possible identifier, so it can only ever be matched deliberately. The cross-stack adapter
 * repeats this literal rather than importing it — the same arrangement `astro:template` already
 * has, because framework adapters must not depend on a language adapter's internals.
 */
const HTTP_CALL_RECEIVER = 'http:client';

const literalUrl = (argument: ts.Expression | undefined): string | undefined => {
  if (argument === undefined) {
    return undefined;
  }
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return undefined; // an interpolated or computed URL states no path
};

/**
 * `fetch(url, { method: 'POST' })` → 'POST'. Only a string LITERAL counts — a spread, a variable
 * or a computed key states no verb, and inventing one would link the wrong route. Uppercased
 * because HTTP methods are case-insensitive (RFC 9110) while route nodes spell them uppercase.
 */
const literalMethodOf = (options: ts.Expression | undefined): string | undefined => {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return undefined;
  }
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'method' &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text.toUpperCase();
    }
  }
  return undefined;
};

/** One recognized HTTP call: what it was called, where it points, and the verb it states. */
interface HttpCall {
  readonly calleeName: string;
  readonly url: string;
  readonly method?: string;
}

/** `fetch(url, init)`, `$fetch(url, options)`, `axios(url, config)` — url first, options second. */
const bareCall = (bindings: HttpClientBindings, call: ts.CallExpression): HttpCall | undefined => {
  if (!ts.isIdentifier(call.expression)) {
    return undefined;
  }
  const name = call.expression.text;
  const recognized =
    GLOBAL_CALLABLES.has(name) || bindings.callables.has(name) || bindings.axios.has(name);
  const url = recognized ? literalUrl(call.arguments[0]) : undefined;
  if (url === undefined) {
    return undefined;
  }
  const method = literalMethodOf(call.arguments[1]);
  return { calleeName: name, url, ...(method === undefined ? {} : { method }) };
};

/** `axios.get(url)` / `api.post(url, body, config)` — the method name states the verb. */
const verbCall = (bindings: HttpClientBindings, call: ts.CallExpression): HttpCall | undefined => {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }
  const receiver = call.expression.expression;
  const method = AXIOS_VERB_METHODS.get(call.expression.name.text);
  if (!ts.isIdentifier(receiver) || method === undefined || !bindings.axios.has(receiver.text)) {
    return undefined;
  }
  const url = literalUrl(call.arguments[0]);
  return url === undefined
    ? undefined
    : { calleeName: `${receiver.text}.${call.expression.name.text}`, url, method };
};

const recordHttpCall = (state: ParseState, call: ts.CallExpression, found: HttpCall): void => {
  const range = rangeOf(state.source, call);
  const evidenceId = state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'call-site', range),
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName: found.calleeName },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName: HTTP_CALL_RECEIVER,
    calleeName: found.calleeName,
    stringArguments: [found.url],
    identifierArguments: [],
    ...(found.method === undefined ? {} : { keywordStringArguments: { method: found.method } }),
    enclosingSymbolNodeId: ownerNodeId(state.filePath, call),
    evidenceId,
  });
};

/** Record every literal-URL HTTP-client call in one already-parsed file, at any nesting depth. */
export const collectHttpCallFacts = (state: ParseState): void => {
  const bindings = httpClientBindings(state.source);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const found = bareCall(bindings, node) ?? verbCall(bindings, node);
      if (found !== undefined) {
        recordHttpCall(state, node, found);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(state.source, visit);
};
