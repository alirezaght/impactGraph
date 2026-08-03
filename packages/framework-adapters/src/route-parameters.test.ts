import { describe, expect, it } from 'vitest';

import { pathParametersOf } from './route-parameters.js';

// §12.1.1 observable requiredness. The load-bearing assertions here are the NEGATIVE ones: brace
// syntax must never yield `required`, however obvious it looks, because the producer did not read
// the declaration that decides it.

describe('colon syntax (Express, NestJS)', () => {
  it('reads a plain segment as required, because the router requires it to match', () => {
    expect(pathParametersOf('/deals/:id', 'colon')).toEqual([
      { name: 'id', requiredness: 'required' },
    ]);
  });

  it('reads a `?`-suffixed segment as optional, because the path syntax states it', () => {
    expect(pathParametersOf('/deals/:id?', 'colon')).toEqual([
      { name: 'id', requiredness: 'optional' },
    ]);
  });

  it('keeps declaration order and mixed requiredness across several segments', () => {
    expect(pathParametersOf('/orgs/:orgId/deals/:dealId?', 'colon')).toEqual([
      { name: 'orgId', requiredness: 'required' },
      { name: 'dealId', requiredness: 'optional' },
    ]);
  });

  it('stops a name at a suffix separator', () => {
    expect(pathParametersOf('/deals/:id.json', 'colon')).toEqual([
      { name: 'id', requiredness: 'required' },
    ]);
  });
});

describe('brace syntax (Spring, FastAPI)', () => {
  it('records requiredness as unknown, because a placeholder states only that a segment is dynamic', () => {
    expect(pathParametersOf('/deals/{id}', 'brace')).toEqual([
      { name: 'id', requiredness: 'unknown' },
    ]);
  });

  it('never infers required from brace syntax, for any path', () => {
    const paths = ['/deals/{id}', '/deals/{deal_id}/items/{itemId}', '/{tenant}/deals'];
    const observed = paths.flatMap((path) => pathParametersOf(path, 'brace'));

    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((parameter) => parameter.requiredness === 'unknown')).toBe(true);
  });

  it('does not read a colon marker as optionality in brace syntax', () => {
    // FastAPI's `{id:path}` converter is not an optionality marker, and this producer does not read
    // converters at all — the whole placeholder body is the name it observed.
    expect(pathParametersOf('/files/{path}', 'brace')).toEqual([
      { name: 'path', requiredness: 'unknown' },
    ]);
  });
});

describe('bracket syntax (Astro file routing)', () => {
  it('reads `[id]` as required, because a non-rest segment must be present to match the file', () => {
    expect(pathParametersOf('/deals/[id]', 'bracket')).toEqual([
      { name: 'id', requiredness: 'required' },
    ]);
  });

  it('reads `[...rest]` as optional, because a rest parameter matches zero segments', () => {
    expect(pathParametersOf('/docs/[...slug]', 'bracket')).toEqual([
      { name: 'slug', requiredness: 'optional' },
    ]);
  });
});

describe('across every syntax', () => {
  it('finds nothing in a static path, and that emptiness is an observation', () => {
    for (const syntax of ['colon', 'brace', 'bracket'] as const) {
      expect(pathParametersOf('/api/deals', syntax)).toEqual([]);
    }
  });

  it('collapses a repeated name rather than reporting it twice', () => {
    expect(pathParametersOf('/a/:id/b/:id', 'colon')).toHaveLength(1);
  });

  it('does not read one syntax with another syntax rules', () => {
    // A Spring path handed the colon rule must not produce a required parameter out of `{id}` — the
    // syntax argument is the producer's statement of what it read, and a mismatch yields nothing
    // rather than a plausible-looking guess.
    expect(pathParametersOf('/deals/{id}', 'colon')).toEqual([]);
    expect(pathParametersOf('/deals/:id', 'brace')).toEqual([]);
  });
});
