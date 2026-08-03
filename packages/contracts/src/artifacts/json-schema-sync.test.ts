// Guards that the committed JSON Schema files stay in sync with the Zod source of truth.
// If this fails, run: pnpm --filter @impactgraph/contracts generate:schemas
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateArtifactJsonSchemas } from '../index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('generated JSON Schemas are committed and current', () => {
  const generated = generateArtifactJsonSchemas();

  it.each(Object.keys(generated))('%s.schema.json matches the Zod source', (name) => {
    const committed = JSON.parse(
      readFileSync(join(packageRoot, 'schemas', `${name}.schema.json`), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(generated[name]);
  });
});
