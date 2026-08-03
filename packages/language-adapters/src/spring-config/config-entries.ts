// What a Spring property source states, and the limits on what may be read out of one.
//
// There is no YAML library here on purpose: adding a dependency needs human approval, and the
// subset Spring configuration actually uses for the values this adapter needs is a nested scalar
// mapping. So the readers below handle exactly that subset and REFUSE everything else — an
// anchor, an alias, a merge key, a sequence, a block scalar, a flow collection, a line the reader
// cannot decompose. A refused line contributes no entry, which downstream means the placeholder
// resolves to nothing.
//
// Two caps that are about untrusted content (PRD §42.5) rather than about YAML:
//
// * SECRET-BEARING KEYS ARE NEVER RECORDED. `spring.datasource.password` is a value the analyzer
//   has no use for and every reason not to carry into a cached fragment. This mirrors the
//   Terraform adapter's refusal to read `.tfvars` VALUES for the same reason — with the difference
//   that a topic name genuinely IS needed downstream, so the rest of the file is read.
// * Values are length-capped. A resource name is short; a 4 MB single-line value is a payload.

/** One `key = value` a configuration file states, with the line it states it on. */
export interface ConfigEntry {
  readonly key: string;
  readonly value: string;
  /** 1-based line, for evidence a reviewer can open. */
  readonly line: number;
}

export interface ConfigRead {
  readonly entries: readonly ConfigEntry[];
  /** Lines that state something this reader deliberately does not decode. */
  readonly skippedLines: number;
}

export const MAX_CONFIG_LINES = 5000;
export const MAX_VALUE_LENGTH = 256;
export const MAX_KEY_LENGTH = 256;

/**
 * Key fragments whose value is a credential by convention. Compared against the key with `-`, `_`
 * and `.` removed, so `client-secret`, `clientSecret` and `client.secret` are all caught.
 */
const SECRET_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'credential',
  'privatekey',
  'apikey',
  'accesskey',
  'authorization',
];

const SEPARATORS = /[-_.]/g;

/** True when this key names a credential — its value must never be recorded. */
export const isSecretKey = (key: string): boolean => {
  const flattened = key.toLowerCase().replace(SEPARATORS, '');
  return SECRET_FRAGMENTS.some((fragment) => flattened.includes(fragment));
};

/** A key this reader is willing to record: no whitespace, bounded, non-empty. */
export const isReadableKey = (key: string): boolean =>
  key.length > 0 && key.length <= MAX_KEY_LENGTH && !/\s/.test(key);

/**
 * Accumulates entries, dropping the ones no consumer may see. A `Map` keyed by key would be wrong
 * here: two documents of one file legitimately state a key twice, and the DISAGREEMENT is the
 * fact the resolver needs (a profile override it must refuse to choose between).
 */
export class ConfigEntries {
  private readonly collected: ConfigEntry[] = [];
  private skipped = 0;

  public add(key: string, value: string, line: number): void {
    if (!isReadableKey(key) || value.length === 0 || value.length > MAX_VALUE_LENGTH) {
      this.skipped += 1;
      return;
    }
    if (isSecretKey(key)) {
      // Not "skipped": the file stated it perfectly well. It is withheld, and saying so in the
      // skipped count would suggest the reader failed at something.
      return;
    }
    this.collected.push({ key, value, line });
  }

  public skip(): void {
    this.skipped += 1;
  }

  public read(): ConfigRead {
    return { entries: this.collected, skippedLines: this.skipped };
  }
}

/** Lines of a file, capped. A file longer than the cap is read up to it and reports the rest. */
export const cappedLines = (content: string): { lines: string[]; truncated: number } => {
  const all = content.split(/\r?\n/);
  return {
    lines: all.slice(0, MAX_CONFIG_LINES),
    truncated: Math.max(0, all.length - MAX_CONFIG_LINES),
  };
};
