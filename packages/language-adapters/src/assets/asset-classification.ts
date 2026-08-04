// Classifying a non-code artifact (item 8: "Treat assets, configuration, and contracts as
// first-class nodes"). Pure decision logic, separated from node emission so each rule can be tested
// against a filename + parsed document without building a graph.

export type AssetKind =
  'locale-bundle' | 'openapi-document' | 'json-schema' | 'event-definition' | 'configuration-file';

/** Directory names that mark a translation bundle in every ecosystem we have met. */
const LOCALE_DIRECTORY = /(^|\/)(locales?|i18n|lang|translations?|messages)(\/|$)/i;

/** BCP-47-ish basenames: `de.json`, `en-GB.json`, `pt_BR.yaml`. */
const LOCALE_BASENAME = /^[a-z]{2}([-_][A-Za-z]{2,4})?\.(json|ya?ml)$/;

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A locale bundle is a map whose leaves are all strings. Requiring that is what keeps `package.json`
 * out: it lives in no locale directory and its leaves are objects and arrays.
 */
const isStringTree = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'string') {
    return true;
  }
  if (depth > 6 || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  return entries.length > 0 && entries.every((entry) => isStringTree(entry, depth + 1));
};

export const looksLikeLocaleBundle = (path: string, document: unknown): boolean =>
  (LOCALE_DIRECTORY.test(path) || LOCALE_BASENAME.test(basenameOf(path))) && isStringTree(document);

const record = (document: unknown): Record<string, unknown> =>
  document !== null && typeof document === 'object' && !Array.isArray(document)
    ? (document as Record<string, unknown>)
    : {};

export const classifyAsset = (path: string, document: unknown): AssetKind | undefined => {
  const object = record(document);
  // Order matters: an OpenAPI document also carries `$schema` in some toolchains, and an AsyncAPI
  // document carries neither, so the most specific marker is checked first.
  if (typeof object['openapi'] === 'string' || typeof object['swagger'] === 'string') {
    return 'openapi-document';
  }
  if (typeof object['asyncapi'] === 'string' || object['channels'] !== undefined) {
    return 'event-definition';
  }
  if (looksLikeLocaleBundle(path, document)) {
    return 'locale-bundle';
  }
  if (typeof object['$schema'] === 'string' || object['properties'] !== undefined) {
    return 'json-schema';
  }
  // Everything else that parsed is committed configuration. Reported as such rather than as an
  // anonymous file: "a config file changed" is actionable, "a file changed" is not.
  return Object.keys(object).length > 0 ? 'configuration-file' : undefined;
};

/** Path shapes that mark a database migration in the ecosystems we index. */
const MIGRATION_PATH =
  /(^|\/)(migrations?|migrate|db\/migrate|alembic\/versions|flyway|liquibase)(\/|$)/i;

export const isMigrationPath = (path: string): boolean => MIGRATION_PATH.test(path);

/**
 * Flatten a locale bundle to dotted keys. Only string leaves become keys — an intermediate object
 * is a namespace, not a translation, and emitting one would produce a node no code ever renders.
 */
export const flattenLocaleKeys = (
  document: unknown,
  prefix = '',
  depth = 0,
): readonly { key: string; value: string }[] => {
  if (typeof document === 'string') {
    return prefix.length === 0 ? [] : [{ key: prefix, value: document }];
  }
  if (depth > 8 || document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [];
  }
  return Object.entries(document as Record<string, unknown>).flatMap(([name, value]) =>
    flattenLocaleKeys(value, prefix.length === 0 ? name : `${prefix}.${name}`, depth + 1),
  );
};

/** `paths['/deals']['get']` → one operation per verb, with its declared operationId. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];

export interface OpenApiOperation {
  readonly method: string;
  readonly path: string;
  readonly operationId?: string;
}

export const openApiOperations = (document: unknown): readonly OpenApiOperation[] => {
  const paths = record(document)['paths'];
  if (paths === null || typeof paths !== 'object') {
    return [];
  }
  const operations: OpenApiOperation[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    const methods = record(item);
    for (const method of HTTP_METHODS) {
      const operation = methods[method];
      if (operation === undefined) {
        continue;
      }
      const operationId = record(operation)['operationId'];
      operations.push({
        method: method.toUpperCase(),
        path,
        ...(typeof operationId === 'string' ? { operationId } : {}),
      });
    }
  }
  return operations;
};
