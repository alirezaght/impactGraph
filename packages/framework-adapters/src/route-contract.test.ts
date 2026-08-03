import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import { routeIdentity } from './route-contract.js';

// §12.1.1 invariant. A route's verb and path are its contract; the display name is presentation.
// The whole point of the migration is that nothing recovers structure from the string again, and an
// invariant nobody enforces is a comment — so this test reads the source.

describe('routeIdentity', () => {
  it('derives id and display name from the contract, not the other way round', () => {
    const identity = routeIdentity('get', '/api/deals', 'colon');

    expect(identity.route).toEqual({
      path: '/api/deals',
      method: 'GET',
      pathParameters: [],
      queryParameters: [],
    });
    expect(identity.name).toBe('GET /api/deals');
    // The historical id shape is kept so cross-stack matching and committed goldens stay stable.
    expect(identity.nodeId).toBe('route:GET /api/deals');
  });

  it('uppercases the verb, because a contract states one verb however it was spelled', () => {
    expect(routeIdentity('post', '/x', 'colon').route.method).toBe('POST');
  });
});

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Reading `node.name` is legitimate — it is a display string. Reading it and then SPLITTING it is
 * how routing structure used to be recovered, so that is what this looks for: a name being indexed,
 * sliced, split or matched apart.
 */
const REPARSE_PATTERNS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\bname\.indexOf\(' '\)/, what: 'splitting a name on its first space' },
  { pattern: /\bname\.split\(' '\)/, what: 'splitting a name on spaces' },
  { pattern: /\bname\.slice\([^)]*space/, what: 'slicing a name around a space offset' },
  {
    pattern: /\bname\.match\(\/\^\(\?:GET|\bname\.match\(\/\^\[A-Z\]/,
    what: 'regex-matching a verb out of a name',
  },
];

/** Migration is the one place allowed to read a legacy name, because that is what migrating IS. */
const MIGRATION_ALLOWLIST = ['packages/contracts/src/artifacts/graph.ts'];

describe('no production code recovers routing information from a display name', () => {
  it('finds no name-splitting in any production source file', async () => {
    const files = await fg('packages/*/src/**/*.ts', {
      cwd: repoRoot,
      ignore: ['**/*.test.ts', '**/node_modules/**', '**/fixtures/**'],
      absolute: true,
    });
    const offenders: string[] = [];
    for (const file of files) {
      const relativePath = relative(repoRoot, file).replaceAll('\\', '/');
      if (MIGRATION_ALLOWLIST.includes(relativePath)) {
        continue;
      }
      const source = readFileSync(file, 'utf8');
      for (const { pattern, what } of REPARSE_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${relativePath}: ${what}`);
        }
      }
    }

    expect(
      offenders,
      'routing structure must come from RouteContract, never from GraphNode.name (§12.1.1)',
    ).toEqual([]);
  });

  it('scans a meaningful number of files, so the invariant cannot pass by finding nothing', async () => {
    const files = await fg('packages/*/src/**/*.ts', {
      cwd: repoRoot,
      ignore: ['**/*.test.ts', '**/node_modules/**', '**/fixtures/**'],
    });

    expect(files.length).toBeGreaterThan(200);
  });
});
