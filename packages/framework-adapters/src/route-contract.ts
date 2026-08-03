import { routeDisplayName } from '@impactgraph/domain';

import type { RouteContract } from '@impactgraph/domain';

// One place where a route node's identity is built, shared by every route-producing adapter
// (§12.1.1). Before this, each adapter formatted `${method} ${path}` into an id and a name, and
// every consumer recovered the two halves by splitting the string back apart. The contract is now
// the fact; the id and the display name are both derived from it.
//
// Parameters are NOT populated here. Placeholder syntax differs per framework and query parameters
// are not stated in a route path at all, so extraction is the routing-parameter step's job. Until
// then the arrays are empty and no propagation rule reads them — see
// docs/engineering/capability-limitations.md.

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
export const routeIdentity = (method: string, path: string): RouteNodeIdentity => {
  const route: RouteContract = {
    path,
    method: method.toUpperCase(),
    pathParameters: [],
    queryParameters: [],
  };
  const name = routeDisplayName(route);
  return { nodeId: `route:${name}`, name, route };
};
