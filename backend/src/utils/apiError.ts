/**
 * Centralised API error helper.
 *
 * - Always logs the real error server-side.
 * - In production, returns a generic "Internal server error" message to
 *   prevent leaking internal details (DB table names, stack traces, etc.).
 * - In development, surfaces the real message for ease of debugging.
 */
import type { Response } from 'express';
import logger from './logger';

export function sendInternalError(res: Response, err: unknown, context?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message, context }, 'Internal server error');

  const clientMessage =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : message;

  res.status(500).json({ error: clientMessage });
}
