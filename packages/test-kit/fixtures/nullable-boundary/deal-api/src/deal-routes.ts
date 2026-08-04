import express from 'express';

import { toDealDto } from './deal-dto.js';
import { loadDealRows } from './deal-repository.js';

const app = express();

// The outbound boundary. The payload carries `expiry`, which may be null.
app.get('/api/deals', (_req, res) => {
  res.json(loadDealRows().map(toDealDto));
});

export { app };
