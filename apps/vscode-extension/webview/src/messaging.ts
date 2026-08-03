import {
  WEBVIEW_PROTOCOL_VERSION,
  parseHostMessage,
  webviewMessageSchema,
} from '@impactgraph/contracts';

import type { HostMessage, MessageParseError, WebviewMessage } from '@impactgraph/contracts';

// Both ends validate (main skill §5): the webview parses every host message against the contract
// before rendering it, and validates its own requests before posting. An unsupported protocol
// version surfaces as a visible, typed error — never a best-effort render.

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  // Injected by the VS Code webview host; callable exactly once per page load.
  function acquireVsCodeApi(): VsCodeApi;
}

let api: VsCodeApi | undefined;

const host = (): VsCodeApi | undefined => {
  if (api === undefined && typeof acquireVsCodeApi === 'function') {
    api = acquireVsCodeApi();
  }
  return api;
};

export type WebviewRequest = Omit<WebviewMessage, 'protocolVersion'>;

/**
 * Post a request to the extension host. Returns the validation error instead of throwing, so a
 * contract mistake shows up in the UI rather than silently doing nothing.
 */
export const postToHost = (request: WebviewRequest): MessageParseError | undefined => {
  const message = { protocolVersion: WEBVIEW_PROTOCOL_VERSION, ...request };
  const parsed = webviewMessageSchema.safeParse(message);
  if (!parsed.success) {
    return {
      code: 'invalid-payload',
      message: parsed.error.issues[0]?.message ?? 'request failed contract validation',
      receivedType: request.type,
    };
  }
  host()?.postMessage(parsed.data);
  return undefined;
};

export interface HostMessageHandlers {
  readonly onMessage: (message: HostMessage) => void;
  readonly onInvalid: (error: MessageParseError) => void;
}

/** Subscribe to host messages; returns the unsubscribe function. */
export const subscribeToHost = (handlers: HostMessageHandlers): (() => void) => {
  const listener = (event: MessageEvent<unknown>): void => {
    const parsed = parseHostMessage(event.data);
    if (parsed.ok) {
      handlers.onMessage(parsed.value);
      return;
    }
    handlers.onInvalid(parsed.error);
  };
  window.addEventListener('message', listener);
  return (): void => {
    window.removeEventListener('message', listener);
  };
};
