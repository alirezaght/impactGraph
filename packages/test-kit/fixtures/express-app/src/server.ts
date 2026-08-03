import express from 'express';

import { dealsRouter } from './deals-router';
import { authenticate, logRequests } from './middleware';

export function healthCheck(): string {
  return 'ok';
}

const app = express();
app.use(logRequests);
app.use(authenticate);
app.use('/deals', dealsRouter);
app.get('/health', healthCheck);
