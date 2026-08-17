import { describe, expect, it } from 'vitest';

import { run } from './secret-scan.js';

// The pre-commit lane runs `secret-scan --staged` through lint-staged, which appends the staged
// file list to the command. Rejecting those paths broke every commit in the repository.
describe('secret-scan argument handling', () => {
  it('accepts trailing file paths in --staged mode', async () => {
    const exitCode = await run(['--staged', 'README.md', 'packages/domain/src/index.ts']);

    expect(exitCode).not.toBe(2);
  });

  it('rejects unknown flags even in --staged mode', async () => {
    const exitCode = await run(['--staged', '--nope']);

    expect(exitCode).toBe(2);
  });

  it('rejects positional arguments outside --staged mode', async () => {
    const exitCode = await run(['README.md']);

    expect(exitCode).toBe(2);
  });
});
