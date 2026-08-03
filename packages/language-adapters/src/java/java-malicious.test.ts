import { describe, expect, it } from 'vitest';

import { createJavaAdapter } from './java-adapter.js';
import { createJavaModuleResolver } from './java-modules.js';

import type { IndexingContext, RepositoryFile } from '../types.js';

// PRD §42.5 — repository content is untrusted. A hostile Java file may at worst produce a wrong
// fact; it may never execute code, escape the repository root, or end the run.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-hostile',
  analysisRunId: 'run-hostile',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const CONTROL: RepositoryFile = {
  relativePath: 'src/main/java/com/example/Control.java',
  content:
    'package com.example;\n\npublic class Control {\n  public boolean healthy() { return true; }\n}\n',
};

const HOSTILE: readonly RepositoryFile[] = [
  {
    // Static initializers and Runtime.exec are parsed as text, never run (PRD §35).
    relativePath: 'src/main/java/com/example/Exec.java',
    content:
      'package com.example;\npublic class Exec {\n  static { Runtime.getRuntime().exec("rm -rf /"); }\n  static { System.loadLibrary("evil"); }\n}\n',
  },
  {
    relativePath: 'src/main/java/com/example/Traversal.java',
    content:
      'package com.example;\nimport ................etc.passwd.Secrets;\npublic class Traversal { String p = "../../../../etc/shadow"; }\n',
  },
  {
    // Broken beyond repair: tree-sitter recovers, the adapter reports, the run continues.
    relativePath: 'src/main/java/com/example/Broken.java',
    content: 'public class { { { @@@ void (\n',
  },
  {
    relativePath: 'src/main/java/-looks-like-a-flag.java',
    content: 'class Flag { int value = 1; }\n',
  },
  {
    relativePath: 'src/main/java/com/example/Deep.java',
    content: `class Deep { int x = ${'('.repeat(400)}1${')'.repeat(400)}; }\n`,
  },
  {
    // An annotation whose arguments carry injection payloads is still just a string.
    relativePath: 'src/main/java/com/example/Annotated.java',
    content:
      'package com.example;\n@SuppressWarnings("\'; DROP TABLE deals; --")\n@RequestMapping("../../../etc")\npublic class Annotated { }\n',
  },
  {
    // Story 16.3: the Pub/Sub detector's lookup tables are keyed by untrusted method and type
    // names. `constructor`, `toString` and `__proto__` must MISS, not reach Object.prototype.
    relativePath: 'src/main/java/com/example/Prototype.java',
    content: `package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import com.google.cloud.pubsub.v1.Publisher;

public class Prototype {
  private final PubSubTemplate constructor = null;
  private final PubSubTemplate __proto__ = null;

  public void go() {
    constructor.toString("deal-events", "x");
    constructor.constructor("deal-events", "x");
    __proto__.hasOwnProperty("deal-events", "x");
    Publisher.constructor("deal-events");
  }
}
`,
  },
  {
    // Story 16.3: a topic name carrying a path traversal and a null byte is still only a name.
    relativePath: 'src/main/java/com/example/HostileTopic.java',
    content: `package com.example;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;

public class HostileTopic {
  private final PubSubTemplate pubSubTemplate = null;

  public void publish() {
    pubSubTemplate.publish("../../../../etc/passwd", "x");
  }
}
`,
  },
];

describe('Java adapter against hostile content (PRD §42.5, §34)', () => {
  it('indexes hostile files without throwing and never loses the control file', async () => {
    const fragment = await createJavaAdapter().indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(fragment.nodes.some((node) => node.id === `file:${CONTROL.relativePath}`)).toBe(true);
    expect(
      fragment.nodes.some((node) => node.id === `symbol:${CONTROL.relativePath}#Control.healthy`),
    ).toBe(true);
    for (const file of HOSTILE) {
      const indexed = fragment.nodes.some((node) => node.id === `file:${file.relativePath}`);
      const warned = fragment.warnings.some((warning) => warning.filePath === file.relativePath);
      expect(indexed || warned, `${file.relativePath} produced neither a fact nor a warning`).toBe(
        true,
      );
    }
  });

  it('reports unparseable content as a warning rather than a failure', async () => {
    const broken = HOSTILE[2] as RepositoryFile;
    const fragment = await createJavaAdapter().indexFiles([broken], CONTEXT);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'parsed with error recovery',
    );
    expect(fragment.warnings.every((warning) => warning.adapterId === 'java')).toBe(true);
  });

  it('records an annotation payload as a string and never as anything executable', async () => {
    const annotated = HOSTILE[5] as RepositoryFile;
    const fragment = await createJavaAdapter().indexFiles([annotated], CONTEXT);
    const names = fragment.decorators.map((fact) => fact.decoratorName);
    expect(names).toContain('SuppressWarnings');
    // The payload survives verbatim as data — which is the point: a wrong fact at worst.
    expect(fragment.decorators.flatMap((fact) => [...fact.stringArguments])).toContain(
      "'; DROP TABLE deals; --",
    );
  });

  it('Pub/Sub lookup tables miss on prototype names instead of answering them (Story 16.3)', async () => {
    const prototype = HOSTILE[6] as RepositoryFile;
    const fragment = await createJavaAdapter().indexFiles([prototype], CONTEXT);
    // Not one of `toString`, `constructor` or `hasOwnProperty` is a publish or subscribe method,
    // so no integration node may exist — an object-literal lookup table would have produced one.
    expect(fragment.nodes.filter((node) => node.category === 'integration')).toEqual([]);
    expect(
      fragment.edges.filter((edge) => edge.type === 'PUBLISHES' || edge.type === 'SUBSCRIBES_TO'),
    ).toEqual([]);
  });

  it('a hostile topic name becomes a node name and never a path (Story 16.3)', async () => {
    const hostile = HOSTILE[7] as RepositoryFile;
    const fragment = await createJavaAdapter().indexFiles([hostile], CONTEXT);
    const topics = fragment.nodes.filter((node) => node.type === 'topic');
    expect(topics.map((node) => node.id)).toEqual(['topic:../../../../etc/passwd']);
    // The traversal lives in the NAME, which is inert data. `path` stays the file we parsed, so
    // nothing downstream can be talked into opening it.
    expect(topics[0]?.path).toBe(hostile.relativePath);
    expect(topics[0]?.knowledge.provenance).toBe('framework-convention');
  });

  it('never resolves an import to anything outside the scanned file set', () => {
    const scanned = new Set(['src/main/java/com/example/Control.java', 'etc/passwd/Secrets.java']);
    const resolve = createJavaModuleResolver(scanned);
    const specifiers = [
      '................etc.passwd.Secrets',
      '..etc.passwd.Secrets',
      'com.example.Control',
      'etc.passwd.Secrets',
      'java.util.List',
    ];
    for (const specifier of specifiers) {
      const resolved = resolve('src/main/java/com/example/Traversal.java', specifier);
      // Membership in the scanned set is the guarantee: no specifier can name a path the scanner
      // never handed us, so resolution can never leave the repository.
      expect(resolved === undefined || scanned.has(resolved), specifier).toBe(true);
    }
    expect(resolve('a/B.java', 'home.user.ssh.IdRsa')).toBeUndefined();
  });

  it('refuses to resolve an ambiguous type rather than picking a winner', () => {
    const scanned = new Set([
      'service-a/src/main/java/com/example/Deal.java',
      'service-b/src/main/java/com/example/Deal.java',
    ]);
    expect(createJavaModuleResolver(scanned)('x/Y.java', 'com.example.Deal')).toBeUndefined();
  });

  it('produces identical output for the same hostile input twice', async () => {
    const adapter = createJavaAdapter();
    const first = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    const second = await adapter.indexFiles([...HOSTILE, CONTROL], CONTEXT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
