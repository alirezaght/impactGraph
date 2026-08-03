import type { ExitCodeName, GraphGroupingDto } from '@impactgraph/contracts';

export type OutputFormat = 'text' | 'json' | 'markdown';

export interface CommandContext {
  readonly rootDir: string;
  readonly format: OutputFormat;
  /** Positional arguments after the command (e.g. the spec file for `analyze`). */
  readonly args: readonly string[];
  /** `--out` — destination for a command that writes a file (`graph`). Resolved against root. */
  readonly outPath?: string | undefined;
  /** `--group` — §18.4 grouping key for the graph export. */
  readonly grouping?: GraphGroupingDto | undefined;
  /** Output sink — stdout in production, captured in tests. Never console.* (lint). */
  readonly write: (line: string) => void;
}

/** A typed command failure, mapped to a §20 exit code by the runner. */
export interface CliFailure {
  readonly category: Exclude<ExitCodeName, 'success'>;
  readonly message: string;
}

export const failure = (
  category: Exclude<ExitCodeName, 'success'>,
  message: string,
): CliFailure => ({ category, message });

export type CommandResult =
  | {
      readonly ok: true;
      readonly warningsFound: boolean;
      /** §20: "discrepancies found" is a distinct outcome, not an error — humans decide policy. */
      readonly discrepanciesFound?: boolean;
    }
  | { readonly ok: false; readonly failure: CliFailure };

export const succeeded = (warningsFound = false): CommandResult => ({ ok: true, warningsFound });

export const failed = (value: CliFailure): CommandResult => ({ ok: false, failure: value });
