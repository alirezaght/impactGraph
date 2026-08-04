import { structuredExtraction } from './structured-extractor.js';

import type { SpecificationExtraction } from './extraction-types.js';

// Deterministic extraction (PRD §8): with no provider, the spec still becomes draft requirements.
// The entry point is kept for compatibility; the work now lives in structured-extractor.ts, which
// respects the specification's own structure and only sentence-splits when there is none.
export const fallbackExtraction = (rawText: string): SpecificationExtraction =>
  structuredExtraction(rawText);
