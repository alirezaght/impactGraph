import { WEBVIEW_PROTOCOL_VERSION } from '@impactgraph/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { postToHost, subscribeToHost } from './messaging.js';
import { INITIAL_STATE, reduce } from './state.js';

import type { HostMessage, MessageParseError } from '@impactgraph/contracts';

// Message validation on the WEBVIEW end (the host validates independently — main skill §5).

const posted: unknown[] = [];

globalThis.acquireVsCodeApi = () => ({
  postMessage: (message: unknown): void => {
    posted.push(message);
  },
  getState: (): unknown => undefined,
  setState: (): void => undefined,
});

afterEach(() => {
  posted.length = 0;
  vi.restoreAllMocks();
});

const emit = (data: unknown): void => {
  window.dispatchEvent(new MessageEvent('message', { data }));
};

describe('webview → host requests', () => {
  it('stamps the protocol version and posts a schema-valid message', () => {
    const failure = postToHost({ type: 'webview/refresh', payload: {} });
    expect(failure).toBeUndefined();
    expect(posted).toEqual([
      { protocolVersion: WEBVIEW_PROTOCOL_VERSION, type: 'webview/refresh', payload: {} },
    ]);
  });

  it('refuses to post an invalid request and reports why', () => {
    const failure = postToHost({
      type: 'webview/open-source',
      payload: { path: '' },
    });
    expect(failure?.code).toBe('invalid-payload');
    expect(posted).toHaveLength(0);
  });
});

describe('host → webview messages', () => {
  it('delivers a valid message', () => {
    const seen: HostMessage[] = [];
    const unsubscribe = subscribeToHost({
      onMessage: (message) => seen.push(message),
      onInvalid: () => undefined,
    });
    emit({
      protocolVersion: WEBVIEW_PROTOCOL_VERSION,
      type: 'host/status',
      payload: { busy: true, label: 'Indexing' },
    });
    unsubscribe();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('host/status');
  });

  it('rejects an unknown protocol version instead of best-effort parsing', () => {
    const errors: MessageParseError[] = [];
    const unsubscribe = subscribeToHost({
      onMessage: () => {
        throw new Error('an unsupported version must never reach the renderer');
      },
      onInvalid: (error) => errors.push(error),
    });
    emit({ protocolVersion: 2, type: 'host/status', payload: { busy: false } });
    unsubscribe();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('unsupported-protocol-version');
  });

  it('rejects malformed and unknown-type messages', () => {
    const errors: MessageParseError[] = [];
    const unsubscribe = subscribeToHost({
      onMessage: () => undefined,
      onInvalid: (error) => errors.push(error),
    });
    emit('not a message');
    emit({ protocolVersion: WEBVIEW_PROTOCOL_VERSION, type: 'host/whatever', payload: {} });
    unsubscribe();
    expect(errors.map((error) => error.code)).toEqual(['malformed', 'unknown-type']);
  });
});

describe('state reducer', () => {
  it('records host errors so the user sees them (§43.6 — never swallowed)', () => {
    const next = reduce(INITIAL_STATE, {
      kind: 'host',
      message: {
        protocolVersion: WEBVIEW_PROTOCOL_VERSION,
        type: 'host/error',
        payload: { code: 'indexingFailure', message: 'no index' },
      },
    });
    expect(next.errors).toEqual(['indexingFailure: no index']);
  });

  it('replaces panel state wholesale — the webview keeps no second source of truth', () => {
    const next = reduce(INITIAL_STATE, {
      kind: 'host',
      message: {
        protocolVersion: WEBVIEW_PROTOCOL_VERSION,
        type: 'host/graph',
        payload: {
          graph: {
            schemaVersion: 1,
            status: 'loaded',
            requirements: [],
            nodes: [],
            edges: [],
            totalNodeCount: 7,
            warnings: [],
          },
        },
      },
    });
    expect(next.graph.totalNodeCount).toBe(7);
  });
});
