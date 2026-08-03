// Two hops from core: worker → api → core. Impact analysis starting at `isExpired` must reach
// here, which it can only do by walking cross-package edges.
import { visibleDeals } from '@fixture/api';

export function runSweep(): number {
  return visibleDeals([], new Date(0).toISOString()).length;
}
