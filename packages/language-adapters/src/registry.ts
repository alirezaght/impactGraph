import { err, ok, validationError, validationIssue } from '@impactgraph/domain';

import type { LanguageAdapter } from './types.js';
import type { Result, ValidationError } from '@impactgraph/domain';

export interface AdapterRegistry {
  readonly adapters: readonly LanguageAdapter[];
  /** The adapter claiming this file's extension, or undefined (→ fallback adapter). */
  adapterFor(filePath: string): LanguageAdapter | undefined;
}

const extensionOf = (filePath: string): string => {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = base.indexOf('.', 1);
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
};

/**
 * Dispatch by file extension. Conflict rule: two adapters claiming the same extension is a
 * configuration error, rejected at construction — never resolved silently (PRD §30).
 */
export const createAdapterRegistry = (
  adapters: readonly LanguageAdapter[],
): Result<AdapterRegistry, ValidationError> => {
  const byExtension = new Map<string, LanguageAdapter>();
  for (const adapter of adapters) {
    for (const extension of adapter.supportedExtensions) {
      const normalized = extension.toLowerCase();
      const existing = byExtension.get(normalized);
      if (existing !== undefined) {
        return err(
          validationError([
            validationIssue(
              'duplicate-id',
              `adapters[${adapter.id}]`,
              `extension '${normalized}' claimed by both '${existing.id}' and '${adapter.id}'`,
            ),
          ]),
        );
      }
      byExtension.set(normalized, adapter);
    }
  }
  return ok({
    adapters,
    adapterFor: (filePath: string): LanguageAdapter | undefined => {
      // Longest matching suffix wins (e.g. ".d.ts" over ".ts").
      const extension = extensionOf(filePath);
      let candidate = extension;
      while (candidate.length > 0) {
        const adapter = byExtension.get(candidate);
        if (adapter !== undefined) {
          return adapter;
        }
        const nextDot = candidate.indexOf('.', 1);
        candidate = nextDot === -1 ? '' : candidate.slice(nextDot);
      }
      return undefined;
    },
  });
};
