import { describe, expect, it } from 'vitest';

import { createJavaAdapter } from './java-adapter.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// epic-16 — Java block scoping (`java-types.ts`). The `java-spring` golden proves the end of the
// chain; this suite pins the resolution itself, because the failure a flattened scope produced was
// a WRONG target rather than a missing one, and a wrong target is only visible per call site.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-java-scope',
  analysisRunId: 'run-java-scope',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const PATH = 'src/main/java/com/example/Caller.java';

const index = (body: string): Promise<GraphFragment> =>
  createJavaAdapter().indexFiles(
    [
      {
        relativePath: PATH,
        content: `package com.example;

public class Caller {
${body}
}
`,
      },
    ],
    CONTEXT,
  );

/** Receiver-type links only: `kind: 'calls'` references whose target is a declared type name. */
const callTargets = async (body: string, method: string): Promise<string[]> => {
  const fragment = await index(body);
  return fragment.symbolReferences
    .filter(
      (reference) =>
        reference.kind === 'calls' &&
        reference.fromSymbolNodeId === `symbol:${PATH}#Caller.${method}`,
    )
    .map((reference) => reference.targetName)
    .sort();
};

describe('Java receiver resolution respects block scope (epic-16)', () => {
  it('resolves same-named locals in SIBLING blocks to their own declared types', async () => {
    const targets = await callTargets(
      `    void run(boolean flag) {
        if (flag) {
            Alpha handle = null;
            handle.first();
        } else {
            Beta handle = null;
            handle.second();
        }
    }`,
      'run',
    );
    // Flattened last-wins attributed BOTH calls to Beta and never mentioned Alpha.
    expect(targets).toEqual(['Alpha', 'Beta']);
  });

  it('does not let a later sibling declaration capture an earlier block’s call', async () => {
    const targets = await callTargets(
      `    void run() {
        {
            Alpha handle = null;
            handle.only();
        }
        {
            Beta handle = null;
            int unused = 1;
        }
    }`,
      'run',
    );
    // The only call in this body is on an Alpha. Flattened last-wins said Beta — a wrong edge.
    expect(targets).toEqual(['Alpha']);
  });

  it('lets an inner block shadow an outer local for calls inside it, and only inside it', async () => {
    const targets = await callTargets(
      `    void run(boolean flag) {
        Alpha handle = null;
        if (flag) {
            Beta handle2 = null;
            handle2.inner();
        }
        handle.outer();
    }`,
      'run',
    );
    expect(targets).toEqual(['Alpha', 'Beta']);
  });

  it('resolves a local that shadows a field to the local, and the field elsewhere', async () => {
    const fragment = await index(`    private Alpha collaborator;

    void shadowed() {
        Beta collaborator = null;
        collaborator.inner();
    }

    void plain() {
        collaborator.outer();
    }`);
    const targetsFor = (method: string): string[] =>
      fragment.symbolReferences
        .filter(
          (reference) =>
            reference.kind === 'calls' &&
            reference.fromSymbolNodeId === `symbol:${PATH}#Caller.${method}`,
        )
        .map((reference) => reference.targetName)
        .sort();
    expect(targetsFor('shadowed')).toEqual(['Beta']);
    expect(targetsFor('plain')).toEqual(['Alpha']);
  });

  it('scopes a for-loop init variable to the loop, not to the rest of the method', async () => {
    const targets = await callTargets(
      `    void run() {
        for (Alpha cursor = null; cursor != null; ) {
            cursor.step();
        }
        Beta cursor = null;
        cursor.after();
    }`,
      'run',
    );
    expect(targets).toEqual(['Alpha', 'Beta']);
  });

  it('resolves a parameter, and prefers a local that shadows it', async () => {
    const targets = await callTargets(
      `    void run(Alpha value) {
        value.fromParameter();
        {
            Beta value2 = null;
            value2.fromLocal();
        }
    }`,
      'run',
    );
    expect(targets).toEqual(['Alpha', 'Beta']);
  });

  it('still resolves nothing for a receiver this file never declares, `var` included', async () => {
    const fragment = await index(`    void run() {
        undeclared.step();
        var inferred = null;
        inferred.step();
    }`);
    // Bare calls are a different channel and are excluded here; what must be absent is any
    // receiver-TYPE link. `var` is Java's inference keyword, not a type name to bind to.
    const targets = fragment.symbolReferences
      .filter((reference) => reference.kind === 'calls')
      .map((reference) => reference.targetName);
    expect(targets).not.toContain('var');
    expect(targets).not.toContain('undeclared');
    expect(targets).not.toContain('inferred');
  });
});
