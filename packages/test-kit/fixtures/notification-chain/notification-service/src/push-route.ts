import express from 'express';

import { projectNotification } from './notification-projection.js';

// The push subscription delivers here. A Pub/Sub push endpoint is an ordinary HTTP route, which is
// why nothing about it looks like messaging until the topic and the subscription are modelled.
const app = express();

app.post('/pubsub/notifications', (req, res) => {
  projectNotification(req.body as { eventType: string; payload: Record<string, unknown> });
  res.status(204).send();
});

export { app };
