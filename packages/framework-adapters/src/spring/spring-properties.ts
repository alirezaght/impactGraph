import { springConfigResource, SPRING_PROPERTY_RECEIVER } from '@impactgraph/language-adapters';

import type { CodeGraph } from '../types.js';

// What this module's Spring configuration states for a key — assembled from the entries the
// `spring-config` language adapter read out of `application*.{yml,properties}`.
//
// Scope is per module (`src/main/resources` of the module that owns the Java file), never
// repository-wide: two modules are two applications, and letting one answer the other's
// placeholder would produce a name this deployment never uses.
//
// A key two files state DIFFERENTLY resolves to nothing. That is the profile case:
// `application.yml` saying `deals.topic: a` and `application-prod.yml` saying `deals.topic: b`
// means the running value depends on which profile is active, which the repository does not state
// and this adapter must not choose. Agreement is fine and collapses to the single stated value.

export interface PropertyValue {
  readonly value: string;
  readonly evidenceId: string;
  readonly filePath: string;
}

/** A key whose files disagree — the profile case. Carries the files so the warning can name them. */
export interface PropertyConflict {
  readonly conflictingFiles: readonly string[];
}

/** What one module's configuration states for one key: a single value, or a disagreement. */
export type Stated = PropertyValue | PropertyConflict;

export const isConflict = (stated: Stated): stated is PropertyConflict =>
  (stated as PropertyConflict).conflictingFiles !== undefined;

/** Module root → key → what the module's configuration states for it. */
export type SpringPropertySources = ReadonlyMap<string, ReadonlyMap<string, Stated>>;

const merge = (existing: Stated | undefined, candidate: PropertyValue): Stated => {
  if (existing === undefined) {
    return candidate;
  }
  if (isConflict(existing)) {
    return { conflictingFiles: [...existing.conflictingFiles, candidate.filePath] };
  }
  return existing.value === candidate.value
    ? existing
    : { conflictingFiles: [existing.filePath, candidate.filePath] };
};

/**
 * Every property the repository's Spring configuration states, grouped by module.
 *
 * Reads only the `spring:config-property` fact channel — no file is opened here, in line with
 * PRD §31: a framework adapter interprets what a language adapter already parsed.
 */
export const springPropertySources = (graph: CodeGraph): SpringPropertySources => {
  const byModule = new Map<string, Map<string, Stated>>();
  for (const fact of graph.callFacts) {
    const resource =
      fact.receiverName === SPRING_PROPERTY_RECEIVER
        ? springConfigResource(fact.filePath)
        : undefined;
    const value = fact.stringArguments[0];
    if (resource === undefined || value === undefined) {
      continue;
    }
    const keys = byModule.get(resource.moduleRoot) ?? new Map<string, Stated>();
    byModule.set(resource.moduleRoot, keys);
    keys.set(
      fact.calleeName,
      merge(keys.get(fact.calleeName), {
        value,
        evidenceId: fact.evidenceId,
        filePath: fact.filePath,
      }),
    );
  }
  return byModule;
};

/** What the configuration states for one key in one module, or undefined when it states nothing. */
export const statedProperty = (
  sources: SpringPropertySources,
  moduleRoot: string,
  key: string,
): Stated | undefined => sources.get(moduleRoot)?.get(key);
