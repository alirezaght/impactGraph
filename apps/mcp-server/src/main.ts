import { serveMcp } from './server.js';

// `impactgraph-mcp [--root <dir>]` — MCP server over stdio (PRD §21). Everything runs
// locally against the workspace; nothing leaves the machine (§9).

const rootFromArgs = (argv: readonly string[]): string => {
  const index = argv.indexOf('--root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value ?? process.cwd();
};

await serveMcp({
  rootDir: rootFromArgs(process.argv.slice(2)),
  input: process.stdin,
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
});
