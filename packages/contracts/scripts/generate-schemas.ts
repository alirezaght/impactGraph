// Regenerates the committed JSON Schema files from the Zod source of truth (ADR-0009).
// Run via: pnpm --filter @impactgraph/contracts generate:schemas
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateArtifactJsonSchemas } from '../src/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [name, schema] of Object.entries(generateArtifactJsonSchemas())) {
  const target = join(packageRoot, 'schemas', `${name}.schema.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
}
