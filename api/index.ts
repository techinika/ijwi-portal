import type { IncomingMessage, ServerResponse } from 'http';
import type { Request, Response } from 'express';
import { createApiApp } from '../server.ts';

const app = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return app(req as unknown as Request, res as unknown as Response);
}
