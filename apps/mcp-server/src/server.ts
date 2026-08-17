import { createInterface } from 'node:readline';

import {
  MCP_SERVER_INSTRUCTIONS,
  MCP_TOOL_CONTRACTS,
  MCP_TOOL_NAMES,
  MCP_TOOL_PREFIX,
} from '@impactgraph/contracts';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { callTool, isKnownTool } from './registry.js';
import { toolResultText } from './summary-text.js';
import { readOwnVersion, SERVER_NAME } from './version.js';

// MCP over stdio: newline-delimited JSON-RPC 2.0. Hand-rolled on purpose — the protocol
// surface used here (initialize, tools/list, tools/call, ping) is small, and the repo takes
// no new runtime dependency without approval. Swapping in the official SDK later only
// replaces this file.

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export interface McpServerOptions {
  readonly rootDir: string;
  readonly input: NodeJS.ReadableStream;
  readonly write: (line: string) => void;
}

const toolListing = (): unknown[] =>
  MCP_TOOL_NAMES.map((name) => ({
    name: `${MCP_TOOL_PREFIX}${name}`,
    description: MCP_TOOL_CONTRACTS[name].description,
    inputSchema: zodToJsonSchema(MCP_TOOL_CONTRACTS[name].input),
  }));

interface ToolResultBody {
  readonly content: readonly { type: 'text'; text: string }[];
  readonly structuredContent: unknown;
  readonly isError?: boolean;
}

const textContent = (payload: unknown): ToolResultBody => ({
  content: [{ type: 'text', text: toolResultText(payload) }],
  structuredContent: payload,
});

const handleToolsCall = async (
  rootDir: string,
  params: Record<string, unknown>,
): Promise<unknown> => {
  const rawName = typeof params['name'] === 'string' ? params['name'] : '';
  const name = rawName.startsWith(MCP_TOOL_PREFIX)
    ? rawName.slice(MCP_TOOL_PREFIX.length)
    : rawName;
  if (!isKnownTool(name)) {
    return {
      ...textContent({
        error: { category: 'configurationError', message: `unknown tool: ${rawName}` },
      }),
      isError: true,
    };
  }
  const outcome = await callTool(rootDir, name, params['arguments']);
  if (!outcome.ok) {
    return { ...textContent({ error: outcome.error }), isError: true };
  }
  return textContent(outcome.payload);
};

const dispatch = async (rootDir: string, request: JsonRpcRequest): Promise<unknown> => {
  const method = request.method ?? '';
  if (method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      // The real version from package.json (item 9) — a client debugging a stale or divergent
      // answer must be able to name the build it talked to.
      serverInfo: { name: SERVER_NAME, version: readOwnVersion() },
      // The coverage-first workflow (§21): validate coverage → index → verify concepts →
      // analyze → present limitations. Stated by the server so no client has to infer it.
      instructions: MCP_SERVER_INSTRUCTIONS,
    };
  }
  if (method === 'ping') {
    return {};
  }
  if (method === 'tools/list') {
    return { tools: toolListing() };
  }
  if (method === 'tools/call') {
    return handleToolsCall(rootDir, request.params ?? {});
  }
  return undefined;
};

const respond = (
  write: McpServerOptions['write'],
  id: JsonRpcRequest['id'],
  body: { result: unknown } | { error: { code: number; message: string } },
): void => {
  write(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...body }));
};

const handleLine = async (options: McpServerOptions, line: string): Promise<void> => {
  if (line.trim().length === 0) {
    return;
  }
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    respond(options.write, null, { error: { code: -32700, message: 'parse error' } });
    return;
  }
  const isNotification = request.id === undefined;
  try {
    const result = await dispatch(options.rootDir, request);
    if (isNotification) {
      return; // notifications (e.g. notifications/initialized) get no response
    }
    if (result === undefined) {
      respond(options.write, request.id, {
        error: { code: -32601, message: `method not found: ${request.method ?? ''}` },
      });
      return;
    }
    respond(options.write, request.id, { result });
  } catch (error) {
    if (!isNotification) {
      const message = error instanceof Error ? error.message : String(error);
      respond(options.write, request.id, { error: { code: -32603, message } });
    }
  }
};

/** Serve MCP over the given streams; resolves when the input stream closes. */
export const serveMcp = async (options: McpServerOptions): Promise<void> => {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    await handleLine(options, line);
  }
};
