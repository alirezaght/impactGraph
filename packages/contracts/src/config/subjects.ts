import { z } from 'zod';

// The addressable kinds of configuration value (§Z5/§Z7). One vocabulary shared by the
// confirmation marker (architecture.yml), the `confirm-value` operation, and the
// `explain_configuration` tool — so "what can be confirmed" and "what can be explained"
// can never drift apart.

export const configSubjectKindSchema = z.enum([
  'context',
  'component',
  'alias',
  'exclusion',
  'rule',
  'detection',
  'ignore',
]);

export type ConfigSubjectKindDto = z.infer<typeof configSubjectKindSchema>;
