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

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as Record<string, unknown>).message);
  }
  return String(err);
}

export function sendInternalError(res: Response, err: unknown, context?: string): void {
  const message = extractMessage(err);
  logger.error({ err: message, context }, 'Internal server error');

  const clientMessage =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : message;

  res.status(500).json({ error: clientMessage });
}
