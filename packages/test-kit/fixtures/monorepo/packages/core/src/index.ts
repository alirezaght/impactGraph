export interface Deal {
  id: string;
  expiresAt: string;
}

export function isExpired(deal: Deal, now: string): boolean {
  return deal.expiresAt < now;
}
