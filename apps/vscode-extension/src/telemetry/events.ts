// §36 telemetry — the allowlist IS the schema. Events are built exclusively through these
// constructors, so a denylisted field (source code, spec text, filenames, repository names,
// graph content) has no code path into an event: every property is an enum, a bucket label,
// or a count. Free-form strings are structurally impossible.

export type TelemetryEventName =
  'command-executed' | 'index-duration' | 'error-category' | 'adapter-used' | 'feature-adopted';

export interface TelemetryEvent {
  readonly name: TelemetryEventName;
  readonly properties: Readonly<Record<string, string | number>>;
}

/** Only ImpactGraph command IDs — validated against the impactgraph.* prefix, never arguments. */
export const commandExecuted = (commandId: string): TelemetryEvent | undefined =>
  commandId.startsWith('impactgraph.')
    ? { name: 'command-executed', properties: { commandId } }
    : undefined;

const DURATION_BUCKETS: readonly { limit: number; label: string }[] = [
  { limit: 3_000, label: '<3s' },
  { limit: 30_000, label: '3-30s' },
  { limit: 120_000, label: '30s-2m' },
  { limit: Number.POSITIVE_INFINITY, label: '>2m' },
];

/** Duration as a bucket label — never the raw value, never file counts tied to a repo. */
export const indexDuration = (milliseconds: number): TelemetryEvent => ({
  name: 'index-duration',
  properties: {
    bucket: DURATION_BUCKETS.find((bucket) => milliseconds < bucket.limit)?.label ?? '>2m',
  },
});

const ERROR_CATEGORIES = new Set([
  'configurationError',
  'indexingFailure',
  'providerFailure',
  'unsupportedProject',
  'internalError',
]);

export const errorCategory = (category: string): TelemetryEvent | undefined =>
  ERROR_CATEGORIES.has(category) ? { name: 'error-category', properties: { category } } : undefined;

const KNOWN_ADAPTERS = new Set(['typescript', 'prisma', 'express', 'nestjs', 'generic', 'custom']);

export const adapterUsed = (adapterId: string): TelemetryEvent | undefined =>
  KNOWN_ADAPTERS.has(adapterId) ? { name: 'adapter-used', properties: { adapterId } } : undefined;

const FEATURES = new Set([
  'analyze',
  'review',
  'export',
  'clarifications',
  'config-history',
  'graph-view',
]);

export const featureAdopted = (feature: string): TelemetryEvent | undefined =>
  FEATURES.has(feature) ? { name: 'feature-adopted', properties: { feature } } : undefined;
