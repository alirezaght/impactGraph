import { readFileSync } from 'node:fs';

// Dogfooding item 9: the CLI had no `--version` and no output stated which build produced it.
// The version is read from this app's own package.json at runtime, resolved relative to the
// module so it works both from source (src/) and packaged (dist/) one level below the package
// root. Version string only: build hashes or dates would have to be invented here, and build
// metadata is a packaging-time follow-up, never a fabrication.

export const CLI_NAME = 'impactgraph';

const FALLBACK_VERSION = 'unknown';

export const readOwnVersion = (): string => {
  try {
    const manifest = new URL('../package.json', import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? (parsed as { version?: unknown }).version
        : undefined;
    return typeof version === 'string' && version.length > 0 ? version : FALLBACK_VERSION;
  } catch {
    // An unreadable manifest degrades to an honest 'unknown' — never an invented number.
    return FALLBACK_VERSION;
  }
};
