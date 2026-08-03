import { matchesAnyGlob, matchesGlob } from './glob.js';

import type { ArchitectureModel } from './types.js';

export interface PathAssignment {
  readonly role?: string | undefined;
  readonly context?: string | undefined;
}

/**
 * Resolve the human-confirmed role/context for a repository path (PRD §16). Later entries win
 * within each list (file order is precedence); a component assignment's context overrides the
 * context derived from context path globs.
 */
export const assignmentFor = (path: string, model: ArchitectureModel): PathAssignment => {
  let context: string | undefined;
  for (const candidate of model.contexts) {
    if (matchesAnyGlob(path, candidate.paths)) {
      context = candidate.name;
    }
  }
  let role: string | undefined;
  for (const component of model.components) {
    if (matchesGlob(path, component.path)) {
      role = component.role ?? role;
      context = component.context ?? context;
    }
  }
  return { role, context };
};

/**
 * Story 8.3: a confirmed mapping whose globs match no existing file is flagged for review —
 * never deleted (§Z5). Returns one human-readable message per stale glob.
 */
export const staleAssignments = (
  model: ArchitectureModel,
  existingPaths: ReadonlySet<string>,
): string[] => {
  const matchesSomething = (glob: string): boolean => {
    for (const path of existingPaths) {
      if (matchesGlob(path, glob)) {
        return true;
      }
    }
    return false;
  };
  const messages: string[] = [];
  for (const context of model.contexts) {
    for (const glob of context.paths) {
      if (!matchesSomething(glob)) {
        messages.push(
          `context '${context.name}' path '${glob}' matches no files — review the mapping (it was kept, not deleted)`,
        );
      }
    }
  }
  for (const component of model.components) {
    if (!matchesSomething(component.path)) {
      messages.push(
        `component assignment '${component.path}' matches no files — review the mapping (it was kept, not deleted)`,
      );
    }
  }
  return messages;
};
