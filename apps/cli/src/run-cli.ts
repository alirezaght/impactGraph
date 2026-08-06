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
import { runVersion } from './commands/version.js';
import { failed } from './context.js';
import { writeJson } from './output.js';

import type { CliFailure, CommandContext, CommandResult, OutputFormat } from './context.js';
import type { ExitCode, GraphGroupingDto, ImpactFilters } from '@impactgraph/contracts';

const USAGE = [
  'Usage: impactgraph <command> [--format text|json|markdown] [--root <dir>]',
  '',
  'Commands:',
  '  init            create .impactgraph/ (config + cache .gitignore)',
  '  index           index the repository into the local knowledge graph',
  '  status          show the current index generation',
  '  architecture    summarize detected packages and graph composition',
  '  graph           write a self-contained diagram to a local HTML file',
  '                  [--out <file.html>] [--group context|application|package]',
  '                  [--analysis <analysisId>]  render an impact analysis instead of the',
  '                  current architecture: what a specification is predicted to touch',
  '  analyze <spec>  analyze a specification against the indexed graph (§46)',
  '                  bounded summary by default; --full for every impact',
  '                  [--top <n>] [--min-likelihood required|likely|possible]',
  '                  [--include-lexical] [--include-excluded]',
  '  approve <id>    approve an impact analysis as the frozen review baseline',
  '  select-option <analysisId> <optionId> [description]  record a §26/§C8 option selection',
  '  export [id]     export the §22 implementation context for coding agents',
  '  review [target] compare the approved analysis against working-tree|commit (§24)',
  '  review accept <nodeId> "<reason>" [category]  accept a discrepancy as a deviation (§24.1)',
  '  config [history|diff [id]|rollback [id]|restore <id>|drift]  config + §Z12/§Z14/§Z10',
  '  version         print the impactgraph version (also --version)',
];

interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly format: OutputFormat;
  readonly rootDir: string;
  readonly outPath?: string | undefined;
  readonly grouping?: GraphGroupingDto | undefined;
  readonly analysisId?: string | undefined;
  readonly full?: boolean | undefined;
  readonly impactFilters?: ImpactFilters | undefined;
  readonly invalid?: string;
}

interface ParseState {
  command: string | undefined;
  positionals: string[];
  format: OutputFormat;
  rootDir: string;
  outPath?: string | undefined;
  grouping?: GraphGroupingDto | undefined;
  analysisId?: string | undefined;
  /** `--full` — emit the complete analyze document instead of the bounded summary (item 9). */
  full?: boolean | undefined;
  impactFilters?: ImpactFilters | undefined;
}

/**
 * Boolean flags consume no value. Kept in their own table because the value-taking parsers below
 * advance the argument index, and treating `--full` as one of those would silently eat the next
 * argument — the exact class of bug `missingValue` was added to stop.
 */
const BOOLEAN_FLAG_PARSERS: Record<string, (state: ParseState) => void> = {
  '--full': (state) => {
    state.full = true;
  },
  /** `--version` — equivalent to the `version` command; never consumes a value (item 9). */
  '--version': (state) => {
    state.command ??= 'version';
  },
  '--include-lexical': (state) => {
    state.impactFilters = { ...state.impactFilters, includeLexicalOnly: true };
  },
  '--include-excluded': (state) => {
    state.impactFilters = { ...state.impactFilters, includeExcluded: true };
  },
};

/**
 * A value-taking flag must be followed by a value, not by the next flag. Without this, `--analysis`
 * with no argument silently swallowed `--root` and then failed with a baffling "analysis not found:
 * '--root'" instead of naming the real mistake.
 */
const missingValue = (
  flag: string,
  value: string | undefined,
  expected: string,
): string | undefined =>
  value === undefined || value.length === 0 || value.startsWith('-')
    ? `${flag} expects ${expected}`
    : undefined;

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
    const invalid = missingValue('--out', value, 'a file path');
    if (invalid !== undefined) {
      return invalid;
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
  '--analysis': (value, state) => {
    const invalid = missingValue('--analysis', value, 'an analysis id');
    if (invalid !== undefined) {
      return invalid;
    }
    state.analysisId = value;
    return undefined;
  },
  '--top': (value, state) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return '--top expects an integer between 1 and 500';
    }
    state.impactFilters = { ...state.impactFilters, topN: parsed };
    return undefined;
  },
  '--min-likelihood': (value, state) => {
    if (value === undefined || !LIKELIHOOD_TIERS.includes(value)) {
      return `--min-likelihood expects ${LIKELIHOOD_TIERS.join(', ')}`;
    }
    state.impactFilters = {
      ...state.impactFilters,
      minLikelihood: value as NonNullable<ImpactFilters['minLikelihood']>,
    };
    return undefined;
  },
};

const LIKELIHOOD_TIERS: readonly string[] = [
  'required',
  'likely',
  'possible',
  'lexical-only',
  'unlikely',
  'excluded',
];

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
    const parseBoolean = BOOLEAN_FLAG_PARSERS[arg];
    if (parseBoolean !== undefined) {
      parseBoolean(state);
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
  version: runVersion,
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
    analysisId: parsed.analysisId,
    full: parsed.full,
    impactFilters: parsed.impactFilters,
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
