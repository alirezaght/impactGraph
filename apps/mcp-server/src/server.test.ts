import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { serveMcp } from './server.js';

// Story 12.1 — JSON-RPC framing over newline-delimited stdio.

const runSession = async (messages: unknown[]): Promise<unknown[]> => {
  const input = new PassThrough();
  const responses: unknown[] = [];
  const done = serveMcp({
    rootDir: '/nonexistent-workspace',
    input,
    write: (line) => responses.push(JSON.parse(line)),
  });
  for (const message of messages) {
    input.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
  }
  input.end();
  await done;
  return responses;
};

const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('MCP stdio server (Story 12.1, PRD §21)', () => {
  it('handshakes, lists all §21 tools with schemas, and answers ping', async () => {
    const responses = await runSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'ping' },
    ]);
    expect(responses).toHaveLength(3); // the notification gets no response

    const init = record(record(responses[0])['result']);
    expect(init['protocolVersion']).toBe('2024-11-05');
    expect(record(init['serverInfo'])['name']).toBe('impactgraph');

    const tools = record(record(responses[1])['result'])['tools'] as {
      name: string;
      inputSchema: unknown;
    }[];
    expect(tools).toHaveLength(40);
    expect(tools.every((tool) => tool.name.startsWith('impactgraph.'))).toBe(true);
    expect(tools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
  });

  it('reports unknown methods, unknown tools, and parse errors as JSON-RPC errors', async () => {
    const responses = await runSession([
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'impactgraph.frobnicate' } },
      'this is not json',
    ]);
    expect(record(record(responses[0])['error'])['code']).toBe(-32601);

    const unknownTool = record(record(responses[1])['result']);
    expect(unknownTool['isError']).toBe(true);

    expect(record(record(responses[2])['error'])['code']).toBe(-32700);
  });

  it('surfaces tool failures as isError results with the typed failure payload', async () => {
    const responses = await runSession([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'impactgraph.get_specification', arguments: { specificationId: 'x' } },
      },
    ]);
    const result = record(record(responses[0])['result']);
    expect(result['isError']).toBe(true);
    const payload = record(result['structuredContent']);
    expect(record(payload['error'])['category']).toBe('configurationError');
  });
});
