import { resolveRuntimePaths, configuredNamesByProcess } from '@impactgraph/application';
import { withIndexStore, loadCurrentGraph } from '../src/graphs.js';

const root = process.argv[2] ?? '';
const loaded = await withIndexStore(root, async (store) => loadCurrentGraph(store));
if (!loaded.ok) throw new Error('graph load failed');
const graph = loaded.value.graph;
const patternArg = process.argv[3];
const paths = resolveRuntimePaths(patternArg === undefined ? { graph } : { graph, urlNamePattern: new RegExp(patternArg, 'i') });
for (const p of paths) {
  console.log(p.id, '| incomplete:', p.incompleteReason ?? '-', '| hops:', p.hops.map(h => `${String((h as any).kind ?? '?')}:${h.name}`).join(' -> '));
}
console.log('--- configuredByProcess');
for (const [k, v] of configuredNamesByProcess(graph)) console.log(k, [...v].join(','));
