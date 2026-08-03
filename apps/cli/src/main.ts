// impactgraph CLI entry point (PRD §20). Thin composition root — all behavior lives in the
// shared core packages; this file only wires stdout and the exit code.
import { runCli } from './run-cli.js';

const exitCode = await runCli(process.argv.slice(2), {
  defaultRoot: process.cwd(),
  write: (line) => process.stdout.write(`${line}\n`),
});
process.exitCode = exitCode;
