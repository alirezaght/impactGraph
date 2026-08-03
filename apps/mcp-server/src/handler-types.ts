import type { MCP_TOOL_CONTRACTS, McpToolName } from '@impactgraph/contracts';
import type { Failable } from '@impactgraph/workspace-engine';
import type { z } from 'zod';

export type ToolInput<N extends McpToolName> = z.infer<(typeof MCP_TOOL_CONTRACTS)[N]['input']>;

export type ToolHandler<N extends McpToolName> = (
  rootDir: string,
  input: ToolInput<N>,
) => Promise<Failable<unknown>>;

export type ToolHandlerMap = { [N in McpToolName]: ToolHandler<N> };
