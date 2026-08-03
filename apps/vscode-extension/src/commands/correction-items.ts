import type { ComponentCorrectionDto } from '@impactgraph/contracts';

// §16/§19 correction commands — the pure part: turning a tree selection or an editor URI into the
// path glob a correction applies to, and into the structured operation the engine will apply.
// No vscode types here, no I/O: the shell only collects the user's choice and calls the engine.

/** The role "Mark as Domain Component" assigns (§19 command title, §16 component type change). */
export const DOMAIN_ROLE = 'domain';

/** Repository-relative path from an absolute one; undefined when the file is outside the root. */
export const relativeTo = (rootDir: string, absolutePath: string): string | undefined => {
  const normalizedRoot = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  if (!absolutePath.startsWith(normalizedRoot)) {
    return undefined;
  }
  const relative = absolutePath.slice(normalizedRoot.length);
  return relative.length === 0 ? undefined : relative;
};

/**
 * The glob a correction targets. A file path is already a valid single-file glob (§17); a
 * directory becomes a recursive glob so the assignment survives files being added to it.
 */
export const correctionGlob = (relativePath: string, isDirectory: boolean): string => {
  const trimmed = relativePath.replace(/\/+$/, '');
  return isDirectory ? `${trimmed}/**` : trimmed;
};

export interface ContextPickItem {
  readonly label: string;
  readonly description: string;
}

/** Declared contexts as quick-pick items; the empty case tells the user how to create one. */
export const contextPickItems = (
  contexts: readonly { name: string; description?: string | undefined; paths: readonly string[] }[],
): ContextPickItem[] =>
  contexts.map((context) => ({
    label: context.name,
    description: context.description ?? `${String(context.paths.length)} path glob(s)`,
  }));

export const NO_CONTEXTS_MESSAGE =
  'ImpactGraph: no bounded contexts declared yet — add one to .impactgraph/architecture.yml first.';

export const markAsDomainOperation = (glob: string): ComponentCorrectionDto => ({
  kind: 'set-component-role',
  path: glob,
  role: DOMAIN_ROLE,
  reason: 'marked as a domain component from the ImpactGraph architecture view (§16)',
});

export const assignToContextOperation = (
  glob: string,
  context: string,
): ComponentCorrectionDto => ({
  kind: 'assign-context',
  path: glob,
  context,
  reason: `assigned to context '${context}' from the ImpactGraph architecture view (§16)`,
});

/** Applied corrections are human-confirmed; the message says so, so provenance stays visible. */
export const correctionAppliedMessage = (kind: string, glob: string, rollbackId: string): string =>
  `ImpactGraph: ${kind} applied to ${glob} as human-confirmed knowledge (undo: ${rollbackId}).`;
