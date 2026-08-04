import type { DealRow } from './deal-dto.js';

export const loadDealRows = (): readonly DealRow[] => [
  { id: 'd-1', title: 'Acme', expiresAt: '2026-12-01' },
  { id: 'd-2', title: 'Globex', expiresAt: null },
];
