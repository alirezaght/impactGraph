import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requireExtension } from './support.js';

// The manifest is read from disk (not from `extension.packageJSON`) so the assertions describe
// the file a reviewer edits, and so drift between `contributes.*` and the code is caught here
// rather than by a user whose command palette entry does nothing.

interface ContributedCommand {
  readonly command?: unknown;
  readonly title?: unknown;
}

interface ContributedView {
  readonly id?: unknown;
  readonly type?: unknown;
}

interface Manifest {
  readonly contributes?: {
    readonly commands?: readonly ContributedCommand[];
    readonly views?: Readonly<Record<string, readonly ContributedView[]>>;
    readonly configuration?: { readonly properties?: Readonly<Record<string, unknown>> };
  };
}

export const readManifest = (): Manifest => {
  const path = join(requireExtension().extensionPath, 'package.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
};

const strings = (values: readonly unknown[]): readonly string[] =>
  values.filter((value): value is string => typeof value === 'string');

export const contributedCommandIds = (): readonly string[] =>
  strings((readManifest().contributes?.commands ?? []).map((entry) => entry.command)).toSorted(
    (a, b) => a.localeCompare(b),
  );

export const contributedViewIds = (): readonly string[] =>
  strings(
    Object.values(readManifest().contributes?.views ?? {})
      .flat()
      .map((view) => view.id),
  );

/** View ids contributed as `"type": "webview"` — the webview suite enables itself on these. */
export const contributedWebviewViewIds = (): readonly string[] =>
  strings(
    Object.values(readManifest().contributes?.views ?? {})
      .flat()
      .filter((view) => view.type === 'webview')
      .map((view) => view.id),
  );

export const configurationPropertyKeys = (): readonly string[] =>
  Object.keys(readManifest().contributes?.configuration?.properties ?? {});
