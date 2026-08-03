// Cross-PACKAGE import: resolves through the workspace, not a relative path. This is the fact a
// monorepo fixture exists to pin — a single-package analysis would lose this edge entirely.
import { isExpired } from '@fixture/core';

import type { Deal } from '@fixture/core';

export function visibleDeals(deals: Deal[], now: string): Deal[] {
  return deals.filter((deal) => !isExpired(deal, now));
}
