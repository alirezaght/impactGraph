import { describe, expect, it } from 'vitest';

import { EXTENSION_API_KEYS, buildExtensionApi } from './extension-api.js';

import type { ExtensionApiInput } from './extension-api.js';

// PRD §35. The gate is the whole point of the file, so it is asserted without Electron: any
// mode other than Test must produce an API with NO handle on SecretStorage, because
// `extension.exports` is readable by every other installed extension.

const secrets = {
  store: () => Promise.resolve(),
  get: () => Promise.resolve(undefined),
  delete: () => Promise.resolve(),
};

// The numeric values VS Code uses: Production = 1, Development = 2, Test = 3.
const input = (mode: number): ExtensionApiInput => ({
  mode,
  testMode: 3,
  secrets,
  reviewPanel: () => undefined,
});

describe('extension API surface (PRD §35)', () => {
  it('exposes SecretStorage only under ExtensionMode.Test', () => {
    expect(buildExtensionApi(input(3)).secrets).toBe(secrets);
  });

  it('exposes nothing in production or development', () => {
    for (const mode of [1, 2]) {
      const api = buildExtensionApi(input(mode));
      expect(api.secrets).toBeUndefined();
      expect(api.reviewPanel).toBeUndefined();
      expect(Object.keys(api)).toEqual([]);
    }
  });

  it('never grows a key beyond the declared allowlist', () => {
    expect(Object.keys(buildExtensionApi(input(3))).sort()).toEqual([...EXTENSION_API_KEYS].sort());
  });

  it('is frozen, so a consumer cannot graft a handle onto it', () => {
    expect(Object.isFrozen(buildExtensionApi(input(1)))).toBe(true);
    expect(Object.isFrozen(buildExtensionApi(input(3)))).toBe(true);
  });
});
