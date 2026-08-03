// The extension's public API object (the value `activate()` returns). Deliberately minimal.
//
// WHY IT EXISTS AT ALL: the @vscode/test-electron suites are bundled SEPARATELY from
// `dist/extension.cjs` (see `src/test/build.mjs`), so importing a module from `src/` inside a
// suite yields a second copy of it — different module-level state, different singletons. The
// running shell's own SecretStorage and its live review panel are therefore unreachable from a
// test extension by any route except `vscode.extensions.getExtension(...).exports`.
//
// WHY IT IS GATED: `exports` is readable by EVERY installed extension. Handing out
// `context.secrets` unconditionally would undo the one property that makes SecretStorage safe —
// it is namespaced per extension precisely so nobody else can read our model-provider key
// (PRD §35). So the handles exist only when the host itself says we were launched with
// `--extensionTestsPath` (`vscode.ExtensionMode.Test`). In Development and Production the API is
// an empty frozen object and there is nothing to hand out.

import type { HostMessage, MessageParseError } from '@impactgraph/contracts';

export interface SecretsAccessor {
  store(key: string, value: string): PromiseLike<void>;
  get(key: string): PromiseLike<string | undefined>;
  delete(key: string): PromiseLike<void>;
}

/** What the review-panel probe may do — the host-side message plumbing, nothing else. */
export interface ReviewPanelProbe {
  /** Host → webview over the real transport; reports whether the live webview took it. */
  post(message: HostMessage): Promise<'delivered' | 'not-delivered' | 'refused'>;
  /** The exact path `onDidReceiveMessage` takes; the parse error the host acted on. */
  receive(raw: unknown): MessageParseError | undefined;
  /** Message types the host accepted from the webview, in arrival order. */
  readonly acceptedTypes: readonly string[];
  /** Message types the live webview took from the host, in send order. */
  readonly deliveredTypes: readonly string[];
}

export interface ImpactGraphExtensionApi {
  /** Present only under `ExtensionMode.Test` — see the note above. */
  readonly secrets?: SecretsAccessor;
  /** Present only under `ExtensionMode.Test`; `undefined` when no panel is open. */
  readonly reviewPanel?: () => ReviewPanelProbe | undefined;
}

/** Exactly the keys the API may ever carry; asserted by the integration lane. */
export const EXTENSION_API_KEYS: readonly string[] = ['secrets', 'reviewPanel'];

export interface ExtensionApiInput {
  /** `context.extensionMode`. */
  readonly mode: number;
  /** `vscode.ExtensionMode.Test`, passed in so this stays testable without the vscode module. */
  readonly testMode: number;
  readonly secrets: SecretsAccessor;
  readonly reviewPanel: () => ReviewPanelProbe | undefined;
}

export const buildExtensionApi = (input: ExtensionApiInput): ImpactGraphExtensionApi =>
  input.mode === input.testMode
    ? Object.freeze({ secrets: input.secrets, reviewPanel: input.reviewPanel })
    : Object.freeze({});
