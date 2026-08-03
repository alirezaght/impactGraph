import { routeDisplayName } from '@impactgraph/domain';

import { NO_QUERY_PARAMETERS, pathParametersOf } from './route-parameters.js';

import type { PathSyntax } from './route-parameters.js';
import type { RouteContract } from '@impactgraph/domain';

// One place where a route node's identity is built, shared by every route-producing adapter
// (§12.1.1). Before this, each adapter formatted `${method} ${path}` into an id and a name, and
// every consumer recovered the two halves by splitting the string back apart. The contract is now
// the fact; the id and the display name are both derived from it.
//
// Path parameters ARE populated here, from the path notation the caller names. The syntax argument
// has no default on purpose: a default would let a producer emit an empty parameter list without
// ever stating what notation it read, and "no parameters found" and "nobody looked" would become
// indistinguishable in the persisted contract.
//
// Query parameters stay empty — a route path does not declare them. See `NO_QUERY_PARAMETERS`.

export interface RouteNodeIdentity {
  readonly nodeId: string;
  readonly name: string;
  readonly route: RouteContract;
}

/**
 * A route's identity from its verb and path. `method` is uppercased because a contract states one
 * verb however the framework spelled it, and the node id keeps its historical
 * `route:<VERB> <path>` shape so cross-stack matching and every committed golden stay stable.
 */
export const routeIdentity = (
  method: string,
  path: string,
  syntax: PathSyntax,
): RouteNodeIdentity => {
  const route: RouteContract = {
    path,
    method: method.toUpperCase(),
    pathParameters: pathParametersOf(path, syntax),
    queryParameters: NO_QUERY_PARAMETERS,
  };
  const name = routeDisplayName(route);
  return { nodeId: `route:${name}`, name, route };
};
