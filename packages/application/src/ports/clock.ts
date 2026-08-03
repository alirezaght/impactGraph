/** Supplies time to the deterministic core — domain code never calls Date.now() (main skill §4). */
export interface ClockPort {
  /** Current instant as an ISO-8601 UTC timestamp. */
  now(): string;
}

/** Supplies stable identifiers — domain code never calls crypto.randomUUID() inline. */
export interface IdentifierPort {
  /** New unique identifier, optionally namespaced (e.g. "snap", "run", "ev"). */
  generate(prefix?: string): string;
}
