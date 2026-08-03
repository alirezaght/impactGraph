import type { CommandContext } from './context.js';
import type { ZodType } from 'zod';

/** Validate-then-print: the CLI validates its own JSON output before emitting (ADR-0009). */
export const writeJson = <T>(context: CommandContext, schema: ZodType<T>, document: T): void => {
  context.write(JSON.stringify(schema.parse(document), null, 2));
};

export const writeLines = (context: CommandContext, lines: readonly string[]): void => {
  for (const line of lines) {
    context.write(line);
  }
};
