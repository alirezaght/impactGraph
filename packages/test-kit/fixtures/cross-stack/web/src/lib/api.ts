// The client-side half of the HTTP correspondence (epic-16, Story 16.6 last open task): a plain
// `.ts` file, not an Astro template, calling the FastAPI service in ../../../api.
//
// `/api/deals` is served by BOTH a GET and a POST handler. A `fetch` with no stated method names
// a path and not a verb, so it correlates with both; a `fetch` with a literal `{ method }`
// correlates with that verb ONLY (see `language-adapters/src/typescript/parse-http-calls.ts`).
//
// `/api/deal` and the absolute URL below are deliberate non-matches.

export async function loadDeals(): Promise<unknown> {
  const response = await fetch('/api/deals');
  return response.json();
}

export async function createDeal(body: string): Promise<unknown> {
  // States its verb literally, so this must link the POST route and NOT the GET one.
  const response = await fetch('/api/deals', { method: 'post', body });
  return response.json();
}

export async function loadOne(id: string): Promise<unknown> {
  // Interpolated: this states a shape, not a path, and must never correlate.
  const response = await fetch(`/api/deals/${id}`);
  return response.json();
}

export async function loadExternal(): Promise<unknown> {
  const response = await fetch('https://example.com/api/deals');
  return response.json();
}
