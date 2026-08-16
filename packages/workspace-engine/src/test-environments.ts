import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DatabaseEngine, TestEnvironmentFact } from '@impactgraph/application';
import type { KnowledgeGraph } from '@impactgraph/domain';

/**
 * What database the TEST SUITE actually runs, read from the test-scoped configuration the index
 * already knows about. Facts only: a connection-string marker in a test config file. A repository
 * that states nothing yields nothing — the analyzer downstream treats absence as silence.
 */

const TEST_SCOPED_PATH =
  /(^|\/)(tests?|__tests__|src\/test)\/|(^|\/)(conftest\.py|pytest\.ini|tox\.ini|application-test\.(ya?ml|properties)|docker-compose\.test\.ya?ml|\.env\.test(\.\w+)?)$/;

const CONFIG_EXTENSION = /\.(py|ya?ml|properties|ini|cfg|toml|env|json)$|(^|\/)\.env\.test/;

/** Connection-string markers, strongest first. Substrings a config states, never inference. */
const ENGINE_MARKERS: readonly { readonly engine: DatabaseEngine; readonly pattern: RegExp }[] = [
  { engine: 'h2', pattern: /jdbc:h2:/i },
  { engine: 'sqlite', pattern: /sqlite(:\/\/|3?:memory|:\/\/\/)|\bsqlite3?\b/i },
  { engine: 'postgres', pattern: /jdbc:postgresql|postgres(ql)?:\/\//i },
  { engine: 'mysql', pattern: /jdbc:mysql|mysql:\/\//i },
];

const MAX_FILES = 20;

const readSmall = (rootDir: string, path: string): string | undefined => {
  try {
    const content = readFileSync(join(rootDir, path), 'utf8');
    return content.length > 0 && content.length < 200_000 ? content : undefined;
  } catch {
    return undefined;
  }
};

export const collectTestEnvironments = (
  rootDir: string,
  graph: KnowledgeGraph,
): readonly TestEnvironmentFact[] => {
  const paths = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (
      node.path !== undefined &&
      TEST_SCOPED_PATH.test(node.path) &&
      CONFIG_EXTENSION.test(node.path)
    ) {
      paths.add(node.path);
    }
  }
  const facts: TestEnvironmentFact[] = [];
  const seen = new Set<string>();
  for (const path of [...paths].sort().slice(0, MAX_FILES)) {
    const content = readSmall(rootDir, path);
    if (content === undefined) {
      continue;
    }
    for (const marker of ENGINE_MARKERS) {
      if (marker.pattern.test(content) && !seen.has(`${marker.engine}:${path}`)) {
        seen.add(`${marker.engine}:${path}`);
        facts.push({ engine: marker.engine, filePath: path, evidenceIds: [] });
      }
    }
  }
  return facts;
};
