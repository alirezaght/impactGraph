import type { FileFacts, FileSymbol } from './file-facts.js';
import type { ImportChange, ImportReference, SymbolChange } from '../types.js';

// Baseline-vs-current comparison. Symbols are keyed by type+name rather than node id so that a
// renamed FILE (whose node ids all change) still reports "the symbols moved", not "everything
// was deleted and re-added" (PRD §24: a rename is one change).

const symbolKey = (symbol: FileSymbol): string => `${symbol.type}#${symbol.name}`;

const importKey = (reference: ImportReference): string =>
  `${reference.isReExport ? 'export' : 'import'}:${reference.specifier}`;

const byKey = <T>(items: readonly T[], key: (item: T) => string): Map<string, T> => {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return map;
};

const sortByString = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

const removedSymbol = (filePath: string, symbol: FileSymbol): SymbolChange => ({
  filePath,
  symbolName: symbol.name,
  nodeType: symbol.type,
  kind: 'removed',
  previousNodeId: symbol.nodeId,
});

const addedSymbol = (filePath: string, symbol: FileSymbol): SymbolChange => ({
  filePath,
  symbolName: symbol.name,
  nodeType: symbol.type,
  kind: 'added',
  nodeId: symbol.nodeId,
});

/** Added / removed / changed symbols. Unchanged symbols are deliberately not reported. */
export const compareSymbols = (
  baseline: FileFacts,
  current: FileFacts,
  filePath: string,
): readonly SymbolChange[] => {
  const before = byKey(baseline.symbols, symbolKey);
  const changes: SymbolChange[] = [];
  for (const symbol of current.symbols) {
    const previous = before.get(symbolKey(symbol));
    if (previous === undefined) {
      changes.push(addedSymbol(filePath, symbol));
    } else if (previous.signature !== symbol.signature) {
      changes.push({
        filePath,
        symbolName: symbol.name,
        nodeType: symbol.type,
        kind: 'changed',
        nodeId: symbol.nodeId,
        previousNodeId: previous.nodeId,
      });
    }
  }
  const after = byKey(current.symbols, symbolKey);
  for (const symbol of baseline.symbols) {
    if (!after.has(symbolKey(symbol))) {
      changes.push(removedSymbol(filePath, symbol));
    }
  }
  return sortByString(
    changes,
    (change) => `${change.kind}:${change.nodeType}#${change.symbolName}`,
  );
};

export const compareImports = (
  baseline: FileFacts,
  current: FileFacts,
  filePath: string,
): readonly ImportChange[] => {
  const before = byKey(baseline.imports, importKey);
  const after = byKey(current.imports, importKey);
  const changes: ImportChange[] = [];
  for (const [key, reference] of after) {
    if (!before.has(key)) {
      changes.push({
        filePath,
        specifier: reference.specifier,
        isReExport: reference.isReExport,
        kind: 'added',
      });
    }
  }
  for (const [key, reference] of before) {
    if (!after.has(key)) {
      changes.push({
        filePath,
        specifier: reference.specifier,
        isReExport: reference.isReExport,
        kind: 'removed',
      });
    }
  }
  return sortByString(changes, (change) => `${change.kind}:${change.specifier}`);
};

/** Every symbol/import in the baseline, reported as removed — a deleted file's whole fragment. */
export const allRemoved = (
  baseline: FileFacts,
  filePath: string,
): { symbolChanges: readonly SymbolChange[]; importChanges: readonly ImportChange[] } => ({
  symbolChanges: sortByString(
    baseline.symbols.map((symbol) => removedSymbol(filePath, symbol)),
    (change) => `${change.nodeType}#${change.symbolName}`,
  ),
  importChanges: sortByString(
    baseline.imports.map((reference) => ({
      filePath,
      specifier: reference.specifier,
      isReExport: reference.isReExport,
      kind: 'removed' as const,
    })),
    (change) => change.specifier,
  ),
});
