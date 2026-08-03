import { createJavaAdapter } from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createSpringAdapter } from './spring-adapter.js';

import type { CodeGraph } from '../types.js';
import type {
  GraphFragment,
  IndexingContext,
  RepositoryFile,
} from '@impactgraph/language-adapters';

// PRD §31/§34 — what Spring enrichment does when the graph does NOT give it what it needs. The
// happy path is pinned by the full-pipeline golden (`packages/test-kit/goldens/java-spring.
// graph.txt`); these are the degradations that must stay visible rather than becoming silence.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-spring',
  analysisRunId: 'run-spring',
  createdAt: '2026-08-02T09:00:00.000Z',
};

/**
 * A minimal stand-in for assembly's name resolution: a Java type is resolvable when some indexed
 * file declares it. Enough for enrichment, and deliberately not a second implementation of the
 * real resolver — cross-file resolution itself is proven by the pipeline golden.
 */
const graphOf = (fragment: GraphFragment): CodeGraph => ({
  nodes: fragment.nodes,
  edges: fragment.edges,
  decorators: fragment.decorators,
  callFacts: fragment.callFacts,
  symbolReferences: fragment.symbolReferences,
  resolveSymbol: (_filePath, name) =>
    fragment.nodes.map((node) => String(node.id)).find((id) => id.endsWith(`#${name}`)),
  importsOf: () => [],
});

const enrich = async (files: readonly RepositoryFile[]): Promise<GraphFragment> => {
  const graph = graphOf(await createJavaAdapter().indexFiles(files, CONTEXT));
  return createSpringAdapter().enrich(graph, {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });
};

const java = (name: string, body: string): RepositoryFile => ({
  relativePath: `src/main/java/com/example/${name}.java`,
  content: `package com.example;\n\n${body}\n`,
});

const edgeIds = (fragment: GraphFragment): string[] =>
  fragment.edges.map((edge) => `${edge.type}|${edge.sourceId}->${edge.targetId}`).sort();

const messages = (fragment: GraphFragment): string =>
  fragment.warnings.map((warning) => warning.message).join(' ');

describe('Spring enrichment (PRD §15.2, §31)', () => {
  it('turns @Scheduled into a job that triggers the annotated method', async () => {
    const fragment = await enrich([
      java(
        'Reaper',
        '@Component\npublic class Reaper {\n  @Scheduled(cron = "0 0 3 * * *")\n  public void reap() {}\n}',
      ),
    ]);
    const job = fragment.nodes.find((node) => node.type === 'job');
    expect(job?.name).toBe('Reaper.reap');
    expect(edgeIds(fragment)).toContain(
      'TRIGGERS|spring:job:symbol:src/main/java/com/example/Reaper.java#Reaper.reap->' +
        'symbol:src/main/java/com/example/Reaper.java#Reaper.reap',
    );
  });

  it('reports @Scheduled on something that is not a method', async () => {
    const fragment = await enrich([java('Odd', '@Scheduled\npublic class Odd {}')]);
    expect(fragment.nodes.some((node) => node.type === 'job')).toBe(false);
    expect(messages(fragment)).toContain('@Scheduled annotates something that is not');
  });

  it('names a @Bean by its explicit name, falling back to the method name', async () => {
    const fragment = await enrich([
      java(
        'Config',
        '@Configuration\npublic class Config {\n  @Bean\n  public Clock clock() { return null; }\n\n  @Bean("archive")\n  public Clock other() { return null; }\n}',
      ),
    ]);
    expect(
      fragment.nodes
        .filter((node) => String(node.id).startsWith('spring:bean:'))
        .map((n) => n.name),
    ).toEqual(['clock', 'archive']);
  });

  it('refuses a @Bean outside an annotated configuration class', async () => {
    const fragment = await enrich([
      java('Loose', 'public class Loose {\n  @Bean\n  public Clock clock() { return null; }\n}'),
    ]);
    expect(fragment.nodes.some((node) => String(node.id).startsWith('spring:bean:'))).toBe(false);
    expect(messages(fragment)).toContain('is not inside an annotated configuration class');
  });

  it('links an @Autowired field to the type it declares', async () => {
    const fragment = await enrich([
      java(
        'Worker',
        '@Component\npublic class Worker {\n  @Autowired\n  private Helper helper;\n}',
      ),
      java('Helper', '@Service\npublic class Helper {}'),
    ]);
    expect(edgeIds(fragment)).toContain(
      'USES|symbol:src/main/java/com/example/Worker.java#Worker->' +
        'symbol:src/main/java/com/example/Helper.java#Helper',
    );
  });

  it('reports an @Autowired field whose type this repository does not contain', async () => {
    const fragment = await enrich([
      java(
        'Worker',
        '@Component\npublic class Worker {\n  @Autowired\n  private RestTemplate rest;\n}',
      ),
    ]);
    expect(fragment.edges.filter((edge) => edge.type === 'USES')).toEqual([]);
    expect(messages(fragment)).toContain('declares a type this repository does not contain');
  });

  it('does not restate a dependency constructor injection already produced', async () => {
    const files = [
      java(
        'Worker',
        '@Component\npublic class Worker {\n  @Autowired\n  private Helper helper;\n\n  public Worker(Helper helper) { this.helper = helper; }\n}',
      ),
      java('Helper', '@Service\npublic class Helper {}'),
    ];
    const language = await createJavaAdapter().indexFiles(files, CONTEXT);
    const targetId = 'symbol:src/main/java/com/example/Helper.java#Helper';
    const classId = 'symbol:src/main/java/com/example/Worker.java#Worker';
    // Stand in for the USES edge assembly builds from the constructor's `injects` reference.
    const withInjection: CodeGraph = {
      ...graphOf(language),
      edges: [
        ...language.edges,
        { id: `injects:${classId}->${targetId}` } as unknown as CodeGraph['edges'][number],
      ],
    };
    const fragment = await createSpringAdapter().enrich(withInjection, {
      indexing: CONTEXT,
      detection: { detected: true, evidenceIds: [], reason: 'test' },
    });
    expect(fragment.edges.filter((edge) => edge.type === 'USES')).toEqual([]);
  });
});

describe('Java receiver-qualified calls (Story 16.5)', () => {
  const references = async (body: string): Promise<string[]> => {
    const fragment = await createJavaAdapter().indexFiles([java('Caller', body)], CONTEXT);
    return fragment.symbolReferences
      .filter((reference) => reference.kind === 'calls')
      .map((reference) => reference.targetName)
      .sort();
  };

  it('binds a call on a field, a parameter and a local to the declared type', async () => {
    expect(
      await references(
        'public class Caller {\n' +
          '  private FieldType a;\n' +
          '  void f(ParamType b) {\n' +
          '    LocalType c = null;\n' +
          '    this.a.go();\n' +
          '    b.go();\n' +
          '    c.go();\n' +
          '  }\n' +
          '}',
      ),
    ).toEqual(['FieldType', 'LocalType', 'ParamType']);
  });

  it('leaves a receiver whose type this file never states alone', async () => {
    // A static call, a chained call and an undeclared name: each stays a CallFact, un-guessed.
    // `helper` is the pre-existing bare-call reference, and is the only thing reported here.
    expect(
      await references(
        'public class Caller {\n' +
          '  void f() {\n' +
          '    SpringApplication.run(Caller.class);\n' +
          '    helper().go();\n' +
          '    mystery.go();\n' +
          '  }\n' +
          '}',
      ),
    ).toEqual(['helper']);
  });

  it('records one reference per collaborator, not per call site', async () => {
    expect(
      await references(
        'public class Caller {\n' +
          '  private Repo repo;\n' +
          '  void f() { repo.a(); repo.b(); repo.c(); }\n' +
          '}',
      ),
    ).toEqual(['Repo']);
  });
});
