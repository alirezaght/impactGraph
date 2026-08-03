// @impactgraph/framework-adapters — FrameworkAdapter implementations (PRD §31).
// Enrichment is additive: adapters read the built CodeGraph and emit new fragments only.

export type { CodeGraph, FrameworkDetection, FrameworkContext, FrameworkAdapter } from './types.js';
export { createNestJsAdapter } from './nestjs/nestjs-adapter.js';
export { createExpressAdapter } from './express/express-adapter.js';
export { createFastApiAdapter } from './fastapi/fastapi-adapter.js';
export { createSpringAdapter } from './spring/spring-adapter.js';
export { createAstroFrameworkAdapter } from './astro/astro-adapter.js';
export { createGenericDetectorsAdapter } from './generic/generic-detectors-adapter.js';
export { createTerraformFrameworkAdapter } from './terraform/terraform-adapter.js';
export { createCrossStackAdapter } from './cross-stack/cross-stack-adapter.js';
export { createCustomDetectionAdapter } from './custom/custom-detection-adapter.js';
export { routeIdentity } from './route-contract.js';
export type { RouteNodeIdentity } from './route-contract.js';
