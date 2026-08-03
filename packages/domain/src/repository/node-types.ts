// PRD §12.1 — the node vocabulary, verbatim, grouped by category. `package` is legitimately
// in two categories, so a node carries both `category` and `type`, validated as a pair.
export const NODE_TYPES_BY_CATEGORY = Object.freeze({
  intent: [
    'specification',
    'requirement',
    'constraint',
    'actor',
    'business-rule',
    'open-question',
    'architectural-decision',
  ],
  domain: [
    'domain',
    'bounded-context',
    'aggregate',
    'entity',
    'value-object',
    'policy',
    'invariant',
    'command',
    'query',
    'domain-event',
  ],
  application: [
    'application',
    'service',
    'module',
    'package',
    'class',
    'interface',
    'function',
    'method',
    'api-endpoint',
    'controller',
    'handler',
    'job',
    'cli-command',
    'ui-component',
    'page',
    'form',
    'test',
  ],
  data: [
    'database',
    'schema',
    'table',
    'collection',
    'column',
    'index',
    'migration',
    'cache',
    'search-index',
  ],
  integration: [
    'topic',
    'queue',
    'subscription',
    'publisher',
    'consumer',
    'webhook',
    'external-api',
    'third-party-service',
  ],
  infrastructure: [
    'terraform-module',
    'terraform-resource',
    'cloud-run-service',
    'cloud-run-job',
    'gcp-project',
    'pubsub-topic',
    'pubsub-subscription',
    'service-account',
    'iam-role',
    'secret',
    'environment-variable',
    'docker-image',
    'deployment-pipeline',
  ],
  repository: ['repository', 'workspace', 'package', 'directory', 'file', 'symbol'],
} as const);

export type NodeCategory = keyof typeof NODE_TYPES_BY_CATEGORY;

export type NodeType = (typeof NODE_TYPES_BY_CATEGORY)[NodeCategory][number];

export const NODE_CATEGORIES = Object.freeze(
  Object.keys(NODE_TYPES_BY_CATEGORY),
) as readonly NodeCategory[];

export const isNodeCategory = (value: unknown): value is NodeCategory =>
  typeof value === 'string' && value in NODE_TYPES_BY_CATEGORY;

export const isNodeTypeInCategory = (category: NodeCategory, type: string): boolean =>
  (NODE_TYPES_BY_CATEGORY[category] as readonly string[]).includes(type);
