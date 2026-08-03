import { z } from 'zod';

// Fields every §Z7 structured configuration operation carries. Extracted so the §16 correction
// variants (corrections.ts) and the general operation vocabulary (operations.ts) share one
// definition without importing each other.

export const operationBaseFields = {
  /** Why this change is being made — becomes part of the audit record (§Z12). */
  reason: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1).optional(),
};
