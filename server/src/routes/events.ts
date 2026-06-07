import { Router } from 'express';
import type { Request, Response } from 'express';
import { addClient, removeClient } from '../lib/events.js';

export const eventsRouter = Router();

// SSE stream of dashboard-affecting changes. Clients (the SPA) open one
// EventSource and refetch their queries on each `change` event.
eventsRouter.get('/', (req: Request, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');

  addClient(res);

  // Comment-line heartbeat keeps intermediaries from closing an idle stream.
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* connection gone; cleanup runs on 'close' */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    removeClient(res);
  });
});
