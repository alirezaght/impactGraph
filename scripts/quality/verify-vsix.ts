// `tsx scripts/quality/verify-vsix.ts <path-to.vsix>` — the packaging gate.
//
// Reads the real archive rather than trusting `.vscodeignore` or the build script, because both
// have failed silently before: `vsce` drops anything under a `node_modules` segment at any depth,
// and an `external` esbuild import produces a working local build and a broken installed one.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { formatViolations, vsixViolations } from './vsix-contents.js';

/** A `.vsix` is a zip; `unzip -Z1` lists entries one per line without extracting anything. */
const listEntries = (vsixPath: string): readonly string[] =>
  execFileSync('unzip', ['-Z1', vsixPath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const main = (): number => {
  const vsixPath = process.argv[2];
  if (vsixPath === undefined) {
    process.stderr.write('usage: verify-vsix.ts <path-to.vsix>\n');
    return 2;
  }
  if (!existsSync(vsixPath)) {
    process.stderr.write(`no such file: ${vsixPath}\n`);
    return 2;
  }

  const entries = listEntries(vsixPath);
  const violations = vsixViolations(entries);
  if (violations.length > 0) {
    process.stderr.write(
      `${vsixPath} violates the packaging contract (${violations.length}):\n` +
        `${formatViolations(violations)}\n`,
    );
    return 1;
  }
  process.stdout.write(`${vsixPath}: ${entries.length} entries, packaging contract satisfied\n`);
  return 0;
};

process.exitCode = main();
