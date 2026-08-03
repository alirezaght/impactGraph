import { zodToJsonSchema } from 'zod-to-json-schema';

import type { StructuredOutputSchema } from '@impactgraph/application';
import type { ZodType } from 'zod';

/**
 * Build the port-level structured-output contract from a Zod source of truth: the JSON Schema
 * advertised to the model is generated, and the parse gate is the same Zod schema — invalid
 * model output can never pass (PRD §34, §47.8).
 */
export const schemaFromZod = <T>(
  name: string,
  zodSchema: ZodType<T>,
): StructuredOutputSchema<T> => ({
  name,
  jsonSchema: zodToJsonSchema(zodSchema, name),
  parse: (raw: unknown): T | undefined => {
    const result = zodSchema.safeParse(raw);
    return result.success ? result.data : undefined;
  },
});
