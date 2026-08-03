// A client-side script an Astro page pulls in with `<script src="../scripts/deal-filter.ts">`.
// Astro bundles a script `src` and resolves it relative to the FILE, which is what makes this a
// repository-local reference rather than a URL.

export const filterDeals = (deals: readonly string[], term: string): readonly string[] =>
  deals.filter((deal) => deal.toLowerCase().includes(term.toLowerCase()));
