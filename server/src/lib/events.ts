// Minimal server-sent-events fan-out. The proxy calls notifyChange() whenever a
// request is logged; connected dashboards receive a `change` event and refetch.
// Kept dependency-free and in-process — this is a single-node local proxy.

import type { Response } from 'express';

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function clientCount(): number {
  return clients.size;
}

/** Broadcast a change of the given kind (e.g. 'request') to all subscribers. */
export function notifyChange(kind: string): void {
  if (clients.size === 0) return;
  const payload = `event: change\ndata: ${JSON.stringify({ kind, t: Date.now() })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}
