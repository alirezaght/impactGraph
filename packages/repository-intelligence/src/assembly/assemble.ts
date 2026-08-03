import { createGraphEdge } from '@impactgraph/domain';
import {
  deterministicEnvelope,
  isTestFilePath,
  mergeFragments,
} from '@impactgraph/language-adapters';

import type { EvidenceRecord, GraphEdge, GraphNode } from '@impactgraph/domain';
import type {
  CallFact,
  DecoratorFact,
  GraphFragment,
  ImportReference,
  IndexingContext,
  ModuleResolver,
  ParseWarning,
  SymbolReference,
} from '@impactgraph/language-adapters';

export interface AssembledGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly EvidenceRecord[];
  readonly warnings: readonly ParseWarning[];
  /** Language-level decorator facts — input for framework enrichment (Epic 03). */
  readonly decorators: readonly DecoratorFact[];
  readonly callFacts: readonly CallFact[];
  /**
   * Every symbol relationship the language adapters reported, resolved or not. Assembly turns
   * the resolvable ones into edges, but the unresolvable ones are still facts a framework adapter
   * needs: `class Deal(BaseModel)` names a base that lives in site-packages, so no EXTENDS edge
   * can exist, yet that reference is exactly what proves the class is a Pydantic model (§15.2).
   */
  readonly symbolReferences: readonly SymbolReference[];
  /** Resolve a name used in a file to a node id (imports, barrels, aliases included). */
  readonly resolveSymbol: (filePath: string, name: string) => string | undefined;
  /** Import references of one file — module specifiers included (custom detection, §Z8). */
  readonly importsOf: (filePath: string) => readonly ImportReference[];
}

const dedupeById = <T extends { id: string }>(records: readonly T[]): Map<string, T> => {
  const map = new Map<string, T>();
  for (const record of records) {
    if (!map.has(record.id)) {
      map.set(record.id, record);
    }
  }
  return map;
};

interface EdgeSpec {
  readonly id: string;
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly evidenceId: string;
  readonly provenance?: 'static-analysis' | 'framework-convention';
}

interface AssemblyState {
  readonly context: IndexingContext;
  readonly resolve: ModuleResolver;
  readonly nodesById: Map<string, GraphNode>;
  readonly edgesById: Map<string, GraphEdge>;
  readonly exportsByFile: Readonly<Record<string, readonly { name: string; nodeId: string }[]>>;
  readonly importsByFile: ReadonlyMap<string, readonly ImportReference[]>;
  readonly warnings: ParseWarning[];
}

const addEdge = (state: AssemblyState, spec: EdgeSpec): void => {
  if (state.edgesById.has(spec.id)) {
    return;
  }
  const result = createGraphEdge({
    id: spec.id,
    type: spec.type,
    sourceId: spec.sourceId,
    targetId: spec.targetId,
    knowledge: deterministicEnvelope(
      state.context,
      [spec.evidenceId],
      spec.provenance ?? 'static-analysis',
    ),
  });
  if (result.ok) {
    state.edgesById.set(spec.id, result.value);
  }
};

/**
 * The name the TARGET module exports for a name this file uses (epic-16 line 140).
 *
 * `import { DealRepository as Repo }` / `from app.models import Deal as DealModel` bind `Repo`
 * and `DealModel` locally, but the target's export table is keyed by `DealRepository` and `Deal`.
 * Looking the local name up there finds nothing, which is how every aliased cross-file reference
 * used to lose its edge. A name with no alias entry is its own exported name.
 *
 * The lookup is a list scan rather than a map read on purpose: `local` comes from untrusted
 * repository text, and a `Record` would answer `constructor` from its prototype (PRD §42.5).
 */
const exportedNameOf = (reference: ImportReference, localName: string): string =>
  reference.aliases?.find((alias) => alias.local === localName)?.exported ?? localName;

/** One re-export hop: the file it points at, and the name to ask that file for. */
interface ReExportHop {
  readonly target: string;
  readonly name: string;
}

const reExportTargets = (
  state: AssemblyState,
  filePath: string,
  name: string,
): readonly ReExportHop[] => {
  const hops: ReExportHop[] = [];
  for (const reExport of state.importsByFile.get(filePath) ?? []) {
    if (!reExport.isReExport) {
      continue;
    }
    const covers = reExport.importedNames.length === 0 || reExport.importedNames.includes(name);
    if (!covers) {
      continue;
    }
    const target = state.resolve(filePath, reExport.specifier);
    if (target !== undefined) {
      // `export { inner as outer } from './m'` re-exports `outer`, but './m' declares `inner`.
      hops.push({ target, name: exportedNameOf(reExport, name) });
    }
  }
  return hops;
};

/** Follow direct exports and (star/named) re-export chains to the defining node. */
const resolveExportedName = (
  state: AssemblyState,
  filePath: string,
  name: string,
  seen: Set<string>,
): string | undefined => {
  if (seen.has(filePath)) {
    return undefined;
  }
  seen.add(filePath);
  const direct = state.exportsByFile[filePath]?.find((entry) => entry.name === name);
  if (direct !== undefined) {
    return direct.nodeId;
  }
  for (const hop of reExportTargets(state, filePath, name)) {
    const resolved = resolveExportedName(state, hop.target, hop.name, seen);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
};

/** Resolve a name used inside a file: local declaration first, then its imports. */
const resolveNameInFile = (
  state: AssemblyState,
  filePath: string,
  name: string,
): string | undefined => {
  const localId = `symbol:${filePath}#${name}`;
  if (state.nodesById.has(localId)) {
    return localId;
  }
  for (const importRef of state.importsByFile.get(filePath) ?? []) {
    if (importRef.isReExport || !importRef.importedNames.includes(name)) {
      continue;
    }
    const target = state.resolve(filePath, importRef.specifier);
    if (target !== undefined) {
      const exported = exportedNameOf(importRef, name);
      const resolved = resolveExportedName(state, target, exported, new Set());
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }
  return undefined;
};

const resolveImportEdges = (state: AssemblyState, imports: readonly ImportReference[]): void => {
  for (const importRef of imports) {
    const target = state.resolve(importRef.fromFilePath, importRef.specifier);
    if (target === undefined) {
      if (importRef.specifier.startsWith('.')) {
        state.warnings.push({
          filePath: importRef.fromFilePath,
          adapterId: 'assembly',
          message: `unresolved import '${importRef.specifier}'`,
        });
      }
      continue;
    }
    addEdge(state, {
      id: `imports:${importRef.fromFilePath}->${target}`,
      type: 'IMPORTS',
      sourceId: importRef.fromFileNodeId,
      targetId: `file:${target}`,
      evidenceId: importRef.evidenceId,
    });
    // A test file importing a module is testing it — naming-convention fact (Story 2.5).
    if (isTestFilePath(importRef.fromFilePath) && !isTestFilePath(target)) {
      addEdge(state, {
        id: `tests:${importRef.fromFilePath}->${target}`,
        type: 'TESTS',
        sourceId: importRef.fromFileNodeId,
        targetId: `file:${target}`,
        evidenceId: importRef.evidenceId,
        provenance: 'framework-convention',
      });
    }
  }
};

const EDGE_TYPE_BY_REFERENCE_KIND: Readonly<Record<string, string>> = {
  extends: 'EXTENDS',
  implements: 'IMPLEMENTS',
  calls: 'CALLS',
  // §12.2.1: consumer → injected dependency. Was USES, which also carried routing, template
  // calls, Terraform references and unclassified bindings.
  injects: 'INJECTS',
};

const resolveSymbolEdges = (state: AssemblyState, fragment: GraphFragment): void => {
  for (const reference of fragment.symbolReferences) {
    const targetId = resolveNameInFile(state, reference.filePath, reference.targetName);
    if (targetId === undefined) {
      // Unresolved calls are recorded, never guessed (Story 2.5 AC).
      state.warnings.push({
        filePath: reference.filePath,
        adapterId: 'assembly',
        message: `unresolved ${reference.kind} target '${reference.targetName}'`,
      });
      continue;
    }
    addEdge(state, {
      id: `${reference.kind}:${reference.fromSymbolNodeId}->${targetId}`,
      type: EDGE_TYPE_BY_REFERENCE_KIND[reference.kind] ?? 'DEPENDS_ON',
      sourceId: reference.fromSymbolNodeId,
      targetId,
      evidenceId: reference.evidenceId,
    });
  }
};

/**
 * Merge adapter fragments into one deduplicated graph: resolve import specifiers into IMPORTS
 * edges and extends/implements references into EXTENDS/IMPLEMENTS edges. Unresolved relative
 * references become warnings — never guesses (PRD §15.1, §34).
 */
export const assembleGraph = (
  fragments: readonly GraphFragment[],
  context: IndexingContext,
  resolve: ModuleResolver,
): AssembledGraph => {
  const merged = mergeFragments(fragments);
  const importsByFile = new Map<string, ImportReference[]>();
  for (const importRef of merged.imports) {
    const list = importsByFile.get(importRef.fromFilePath) ?? [];
    list.push(importRef);
    importsByFile.set(importRef.fromFilePath, list);
  }
  const state: AssemblyState = {
    context,
    resolve,
    nodesById: dedupeById(merged.nodes),
    edgesById: dedupeById(merged.edges),
    exportsByFile: merged.exportsByFile,
    importsByFile,
    warnings: [...merged.warnings],
  };
  resolveImportEdges(state, merged.imports);
  resolveSymbolEdges(state, merged);
  return {
    nodes: [...state.nodesById.values()],
    edges: [...state.edgesById.values()],
    evidence: [...dedupeById(merged.evidence).values()],
    warnings: state.warnings,
    decorators: merged.decorators,
    callFacts: merged.callFacts,
    symbolReferences: merged.symbolReferences,
    resolveSymbol: (filePath, name) => resolveNameInFile(state, filePath, name),
    importsOf: (filePath) => importsByFile.get(filePath) ?? [],
  };
};
