import { cliErrorOutputSchema, EXIT_CODES, GRAPH_GROUPING_KEYS } from '@impactgraph/contracts';

import { runAnalyze } from './commands/analyze.js';
import { runApprove } from './commands/approve.js';
import { runArchitecture } from './commands/architecture.js';
import { runConfig } from './commands/config.js';
import { runExport } from './commands/export.js';
import { runGraph } from './commands/graph.js';
import { runIndex } from './commands/index-command.js';
import { runInit } from './commands/init.js';
import { runReview } from './commands/review.js';
import { runSelectOption } from './commands/select-option.js';
import { runStatus } from './commands/status.js';
import { failed } from './context.js';
import { writeJson } from './output.js';

import type { CliFailure, CommandContext, CommandResult, OutputFormat } from './context.js';
import type { ExitCode, GraphGroupingDto } from '@impactgraph/contracts';

const USAGE = [
  'Usage: impactgraph <command> [--format text|json|markdown] [--root <dir>]',
  '',
  'Commands:',
  '  init            create .impactgraph/ (config + cache .gitignore)',
  '  index           index the repository into the local knowledge graph',
  '  status          show the current index generation',
  '  architecture    summarize detected packages and graph composition',
  '  graph           write a self-contained architecture diagram to a local HTML file',
  '                  [--out <file.html>] [--group context|application|package]',
  '  analyze <spec>  analyze a specification against the indexed graph (§46)',
  '  approve <id>    approve an impact analysis as the frozen review baseline',
  '  select-option <analysisId> <optionId> [description]  record a §26/§C8 option selection',
  '  export [id]     export the §22 implementation context for coding agents',
  '  review [target] compare the approved analysis against working-tree|commit (§24)',
  '  review accept <nodeId> "<reason>" [category]  accept a discrepancy as a deviation (§24.1)',
  '  config [history|diff [id]|rollback [id]|restore <id>|drift]  config + §Z12/§Z14/§Z10',
];

interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly format: OutputFormat;
  readonly rootDir: string;
  readonly outPath?: string | undefined;
  readonly grouping?: GraphGroupingDto | undefined;
  readonly invalid?: string;
}

interface ParseState {
  command: string | undefined;
  positionals: string[];
  format: OutputFormat;
  rootDir: string;
  outPath?: string | undefined;
  grouping?: GraphGroupingDto | undefined;
}

/** Each flag parser consumes the following value and returns an error message or undefined. */
const FLAG_PARSERS: Record<
  string,
  (value: string | undefined, state: ParseState) => string | undefined
> = {
  '--format': (value, state) => {
    if (value !== 'text' && value !== 'json' && value !== 'markdown') {
      return '--format expects text, json, or markdown';
    }
    state.format = value;
    return undefined;
  },
  '--root': (value, state) => {
    if (value === undefined) {
      return '--root expects a directory';
    }
    state.rootDir = value;
    return undefined;
  },
  '--out': (value, state) => {
    if (value === undefined || value.length === 0) {
      return '--out expects a file path';
    }
    state.outPath = value;
    return undefined;
  },
  '--group': (value, state) => {
    if (value === undefined || !(GRAPH_GROUPING_KEYS as readonly string[]).includes(value)) {
      return `--group expects ${GRAPH_GROUPING_KEYS.join(', ')}`;
    }
    state.grouping = value as GraphGroupingDto;
    return undefined;
  },
};

export const parseArgs = (argv: readonly string[], defaultRoot: string): ParsedArgs => {
  const state: ParseState = {
    command: undefined,
    positionals: [],
    format: 'text',
    rootDir: defaultRoot,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    const parseFlag = FLAG_PARSERS[arg];
    if (parseFlag !== undefined) {
      const invalid = parseFlag(argv[index + 1], state);
      if (invalid !== undefined) {
        return { ...state, invalid };
      }
      index += 1;
    } else if (!arg.startsWith('-')) {
      if (state.command === undefined) {
        state.command = arg;
      } else {
        state.positionals.push(arg);
      }
    } else {
      return { ...state, invalid: `unknown argument '${arg}'` };
    }
  }
  return state;
};

/** The command table — one entry per §20 command; the runner maps results to exit codes. */
const COMMANDS: Record<
  string,
  (context: CommandContext) => CommandResult | Promise<CommandResult>
> = {
  init: runInit,
  index: runIndex,
  status: runStatus,
  architecture: runArchitecture,
  graph: runGraph,
  analyze: runAnalyze,
  approve: runApprove,
  'select-option': runSelectOption,
  export: runExport,
  review: runReview,
  config: runConfig,
};

const dispatch = async (command: string, context: CommandContext): Promise<CommandResult> => {
  const run = COMMANDS[command];
  return run === undefined
    ? failed({ category: 'configurationError', message: `unknown command '${command}'` })
    : run(context);
};

const reportFailure = (context: CommandContext, cause: CliFailure): void => {
  if (context.format === 'json') {
    writeJson(context, cliErrorOutputSchema, {
      schemaVersion: 1,
      error: { category: cause.category, message: cause.message },
    });
  } else {
    context.write(`error (${cause.category}): ${cause.message}`);
  }
};

export const runCli = async (
  argv: readonly string[],
  options: { defaultRoot: string; write: (line: string) => void },
): Promise<ExitCode> => {
  const parsed = parseArgs(argv, options.defaultRoot);
  const context: CommandContext = {
    rootDir: parsed.rootDir,
    format: parsed.format,
    args: parsed.positionals,
    outPath: parsed.outPath,
    grouping: parsed.grouping,
    write: options.write,
  };
  if (parsed.invalid !== undefined || parsed.command === undefined) {
    for (const line of USAGE) {
      options.write(line);
    }
    if (parsed.invalid !== undefined) {
      reportFailure(context, { category: 'configurationError', message: parsed.invalid });
    }
    return EXIT_CODES.configurationError;
  }
  try {
    const result = await dispatch(parsed.command, context);
    if (!result.ok) {
      reportFailure(context, result.failure);
      return EXIT_CODES[result.failure.category];
    }
    if (result.discrepanciesFound === true) {
      return EXIT_CODES.reviewDiscrepancies;
    }
    return result.warningsFound ? EXIT_CODES.warningsFound : EXIT_CODES.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportFailure(context, { category: 'internalError', message });
    return EXIT_CODES.internalError;
  }
};
