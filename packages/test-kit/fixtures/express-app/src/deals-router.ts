import { Router } from 'express';

export function listDeals(): string[] {
  return [];
}

export function getDeal(): string {
  return 'deal';
}

export function createDeal(): void {}

export const dealsRouter = Router();
dealsRouter.get('/', listDeals);
dealsRouter.get('/:id', getDeal);
dealsRouter.post('/', createDeal);
