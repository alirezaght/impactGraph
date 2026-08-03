/**
 * Effective-LOC checker CLI (`pnpm quality:loc`).
 *
 * Usage:
 *   quality:loc                       scan the default include globs
 *   quality:loc --files <paths...>    check only these files (lint-staged);
 *                                     ignore globs still apply
 *   quality:loc --json                machine-readable output
 *
 * Exit codes: 0 clean, 1 violations or expired/invalid exceptions,
 * 2 usage/config errors.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import fg from 'fast-glob';

import { defaultRegistry } from './analyzer.js';
import { DEFAULT_LOC_CONFIG, matchesAnyGlob, type LocConfig } from './config.js';
import { LocExceptionsError, loadLocExceptions } from './exceptions.js';
import { buildReport, formatJsonReport, formatTextReport, type FileLocResult } from './report.js';

const USAGE = `usage: quality:loc [--files <paths...>] [--json]

  --files <paths...>  check only the given files (ignore globs still apply)
  --json              emit a stable JSON report instead of text
  --help              show this message

exit codes: 0 clean; 1 violations or expired/invalid exceptions; 2 usage/config error
`;

class UsageError extends Error {}

interface CliArgs {
  files: string[] | undefined;
  json: boolean;
  help: boolean;
}

/** Collects the values following `--files` up to the next flag. */
function collectFilePaths(
  argv: readonly string[],
  startIndex: number,
): { files: string[]; nextIndex: number } {
  const files: string[] = [];
  let index = startIndex;
  while (index < argv.length) {
    const value = argv[index];
    if (value === undefined || value.startsWith('--')) break;
    files.push(value);
    index += 1;
  }
  if (files.length === 0) throw new UsageError('--files requires at least one path');
  return { files, nextIndex: index };
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { files: undefined, json: false, help: false };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    index += 1;
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--files') {
      const collected = collectFilePaths(argv, index);
      args.files = [...(args.files ?? []), ...collected.files];
      index = collected.nextIndex;
    } else throw new UsageError(`unknown argument: ${String(arg)}`);
  }
  return args;
}

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export interface RunOptions {
  /** CLI arguments (defaults to process.argv.slice(2)). */
  argv?: readonly string[];
  /** Repository root (defaults to process.cwd()). */
  cwd?: string;
  /** Config overrides for tests; merged over DEFAULT_LOC_CONFIG. */
  config?: Partial<LocConfig>;
  writeOut?: (text: string) => void;
  writeErr?: (text: string) => void;
}

interface RunContext {
  argv: readonly string[];
  cwd: string;
  config: LocConfig;
  out: (text: string) => void;
  err: (text: string) => void;
}

function createRunContext(options: RunOptions): RunContext {
  return {
    argv: options.argv ?? process.argv.slice(2),
    cwd: path.resolve(options.cwd ?? process.cwd()),
    config: { ...DEFAULT_LOC_CONFIG, ...options.config },
    out: options.writeOut ?? ((text: string): void => void process.stdout.write(text)),
    err: options.writeErr ?? ((text: string): void => void process.stderr.write(text)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ExceptionsOutcome =
  { exceptions: ReturnType<typeof loadLocExceptions> } | { exitCode: number; message: string };

function loadExceptionsSafely(cwd: string, config: LocConfig): ExceptionsOutcome {
  try {
    return {
      exceptions: loadLocExceptions({
        filePath: path.resolve(cwd, config.exceptionsFile),
        rootDir: cwd,
      }),
    };
  } catch (error) {
    if (error instanceof LocExceptionsError) {
      return { exitCode: error.kind === 'io' ? 2 : 1, message: error.message };
    }
    throw error;
  }
}

/** Explicit `--files` mode: ignore globs and analyzer support still apply. */
function selectExplicitFiles(files: readonly string[], cwd: string, config: LocConfig): string[] {
  const selected: string[] = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new UsageError(`no such file: ${file}`);
    }
    const relative = toPosix(path.relative(cwd, absolute));
    if (matchesAnyGlob(relative, config.ignoreGlobs)) continue;
    if (defaultRegistry.find(relative) === undefined) continue;
    selected.push(relative);
  }
  return selected;
}

async function discoverFiles(
  files: readonly string[] | undefined,
  cwd: string,
  config: LocConfig,
): Promise<string[]> {
  const found =
    files !== undefined
      ? selectExplicitFiles(files, cwd, config)
      : await fg([...config.includeGlobs], {
          cwd,
          ignore: [...config.ignoreGlobs],
          onlyFiles: true,
          dot: false,
        });
  return [...new Set(found)].sort();
}

function analyzeFiles(
  relativeFiles: readonly string[],
  cwd: string,
  config: LocConfig,
  exceptions: ReturnType<typeof loadLocExceptions>,
): FileLocResult[] {
  const results: FileLocResult[] = [];
  for (const relative of relativeFiles) {
    const analyzer = defaultRegistry.find(relative);
    if (analyzer === undefined) continue;
    const sourceText = readFileSync(path.join(cwd, relative), 'utf8');
    const { effectiveLines, totalLines } = analyzer.analyze(relative, sourceText);
    const exception = exceptions.get(relative);
    results.push({
      path: relative,
      effectiveLines,
      totalLines,
      maxLines: exception?.maxLines ?? config.maxEffectiveLines,
      exceptionApplied: exception !== undefined,
    });
  }
  return results;
}

async function execute(args: CliArgs, context: RunContext): Promise<number> {
  const { cwd, config, out, err } = context;
  const outcome = loadExceptionsSafely(cwd, config);
  if ('exitCode' in outcome) {
    err(`effective-loc: ${outcome.message}\n`);
    return outcome.exitCode;
  }

  let relativeFiles: string[];
  try {
    relativeFiles = await discoverFiles(args.files, cwd, config);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`effective-loc: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const report = buildReport(analyzeFiles(relativeFiles, cwd, config, outcome.exceptions));
  out(args.json ? `${formatJsonReport(report)}\n` : formatTextReport(report));
  return report.violations.length > 0 ? 1 : 0;
}

export async function run(options: RunOptions = {}): Promise<number> {
  const context = createRunContext(options);
  let args: CliArgs;
  try {
    args = parseArgs(context.argv);
  } catch (error) {
    context.err(`effective-loc: ${errorMessage(error)}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    context.out(USAGE);
    return 0;
  }
  return execute(args, context);
}

// Direct-invocation guard that works under both CJS and ESM module
// interpretation (no `import.meta`, no top-level await): when vitest imports
// this module, argv[1] is the vitest binary, not this script.
const invokedScript = process.argv[1];
const isDirectRun =
  invokedScript !== undefined &&
  /\/effective-loc\/src\/cli\.(?:ts|js|mts|mjs)$/.test(
    path.resolve(invokedScript).replace(/\\/g, '/'),
  );
if (isDirectRun) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
