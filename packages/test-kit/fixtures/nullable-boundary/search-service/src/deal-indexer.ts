import { fetchDeals } from './deal-client.js';

// The trap the trials said went unreported. Three separate behaviours act on a null `expiry`:
//
//  1. `compactDocument` DROPS null-valued keys, so the indexed document has no `expiry` at all.
//  2. `mergeDefaults` then supplies a fallback, which masks the drop for some readers.
//  3. `indexDeals` SKIPS the row entirely when the merged document still has no expiry.
//
// Each one is a few lines; together they mean "a deal with no expiry silently disappears from
// search", which is exactly the kind of behaviour a diff review cannot see.
export interface SearchDocument {
  readonly id: string;
  readonly title: string;
  readonly expiry?: string;
}

/** Removes null-valued keys. A null `expiry` becomes an ABSENT `expiry`. */
export const compactDocument = (document: Record<string, unknown>): Record<string, unknown> => {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (value !== null && value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted;
};

/** Supplies fallbacks for absent keys — masking the drop above for anything with a default. */
export const mergeDefaults = (
  document: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> => ({ ...defaults, ...document });

export const indexDeals = async (): Promise<readonly SearchDocument[]> => {
  const remote = await fetchDeals();
  const documents: SearchDocument[] = [];
  for (const deal of remote) {
    const compacted = compactDocument({ id: deal.id, title: deal.title, expiry: deal.expiry });
    const merged = mergeDefaults(compacted, { title: 'untitled' });
    if (merged['expiry'] === undefined) {
      // ROW SKIPPED. Nothing logs it and nothing surfaces it.
      continue;
    }
    documents.push(merged as unknown as SearchDocument);
  }
  return documents;
};
