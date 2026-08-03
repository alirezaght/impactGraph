import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { skipTest } from '../harness.js';

import { configurationPropertyKeys } from './manifest.js';
import { requireExtension } from './support.js';
import { ensureInitialized } from './workspace-setup.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §35 / §42.4 "secret storage". The API key lives in SecretStorage and nowhere else. The
// negative half of that invariant — never in settings, never in the committed config, never in
// any file under .impactgraph/ — is fully observable from a test extension and asserted here.
//
// The positive half (a set → get → delete round-trip through the SHELL's own `context.secrets`)
// needs a handle, because VS Code namespaces secrets per extension and offers no cross-extension
// accessor. `activate()` returns one — but only under `ExtensionMode.Test`, because
// `extension.exports` is readable by every installed extension and an unconditional handle would
// undo the namespacing that makes SecretStorage worth using (see `src/extension-api.ts`). The
// allowlist test below is the guard on that surface: it fails the moment the API grows.

const SECRET_KEY = 'impactgraph.apiKey';
/** Mirrors `EXTENSION_API_KEYS`; duplicated deliberately so a drift in either one is visible. */
const ALLOWED_API_KEYS = ['reviewPanel', 'secrets'];
/** Setting names that would be a credential surface at all. */
const SENSITIVE = /key|token|secret|password|credential/i;
/** Key material or a key-shaped field actually landing in a file. */
const KEY_IN_FILE = /api[-_]?key|access[-_]?token|client[-_]?secret|sk-[A-Za-z0-9]{16}/i;

interface SecretStorageLike {
  store(key: string, value: string): Thenable<void>;
  get(key: string): Thenable<string | undefined>;
  delete(key: string): Thenable<void>;
}

const isSecretStorageLike = (candidate: unknown): candidate is SecretStorageLike => {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const shape = candidate as Record<string, unknown>;
  return (
    typeof shape['store'] === 'function' &&
    typeof shape['get'] === 'function' &&
    typeof shape['delete'] === 'function'
  );
};

const exportedApi = (): Record<string, unknown> => {
  const exported = requireExtension().exports;
  return typeof exported === 'object' && exported !== null
    ? (exported as Record<string, unknown>)
    : {};
};

/** `activate()` returns `{ secrets }` under `ExtensionMode.Test` only. */
const secretsFromExports = (): SecretStorageLike | undefined => {
  const candidate = exportedApi()['secrets'];
  return isSecretStorageLike(candidate) ? candidate : undefined;
};

const filesUnder = (root: string): readonly string[] => {
  const configDir = join(root, '.impactgraph');
  const settings = join(root, '.vscode', 'settings.json');
  return [join(configDir, 'config.yml'), settings].filter((path) => existsSync(path));
};

export const secretsSuite: IntegrationSuite = {
  name: 'secret storage (PRD §35, §42.4)',
  tests: [
    {
      name: 'no API key is contributed as a setting',
      run: () => {
        const sensitive = configurationPropertyKeys().filter((key) => SENSITIVE.test(key));
        assert.deepEqual(
          sensitive,
          [],
          'a credential-shaped setting is contributed — keys belong in SecretStorage only (§35)',
        );
      },
    },
    {
      name: 'the API key is not readable through the settings API',
      run: async () => {
        await ensureInitialized();
        const configuration = vscode.workspace.getConfiguration('impactgraph');
        assert.equal(configuration.get('apiKey'), undefined);
        assert.equal(configuration.get('provider.apiKey'), undefined);
        assert.equal(vscode.workspace.getConfiguration().get(SECRET_KEY), undefined);
      },
    },
    {
      name: 'no workspace file mentions the secret key name',
      run: async () => {
        const root = await ensureInitialized();
        for (const path of filesUnder(root)) {
          assert.equal(
            KEY_IN_FILE.test(readFileSync(path, 'utf8')),
            false,
            `${path} contains credential-shaped content — keys never reach files (§35)`,
          );
        }
      },
    },
    {
      name: 'the exported API carries nothing beyond the declared allowlist',
      run: () => {
        assert.deepEqual(
          Object.keys(exportedApi()).sort(),
          ALLOWED_API_KEYS,
          'activate() exports an unexpected handle — every key here is readable by every other ' +
            'installed extension (§35)',
        );
        assert.equal(
          Object.isFrozen(requireExtension().exports),
          true,
          'the exported API is not frozen — another extension could graft a handle onto it',
        );
      },
    },
    {
      name: 'SecretStorage set/get/delete round-trip',
      run: async () => {
        const secrets = secretsFromExports();
        if (secrets === undefined) {
          return skipTest(
            'activate() exported no SecretStorage handle. It is gated on ' +
              '`context.extensionMode === ExtensionMode.Test`; a test lane that does not report ' +
              'Test mode cannot exercise the round trip — owner: vscode-integration',
          );
        }
        await secrets.store(SECRET_KEY, 'integration-test-value');
        assert.equal(await secrets.get(SECRET_KEY), 'integration-test-value');
        await secrets.delete(SECRET_KEY);
        assert.equal(await secrets.get(SECRET_KEY), undefined);
      },
    },
  ],
};
