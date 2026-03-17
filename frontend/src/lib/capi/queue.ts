/**
 * Browser-Side CAPI Event Queue
 *
 * A lightweight localStorage-backed queue for CAPI events that failed to
 * deliver due to network issues. On reconnect (or manual flush), queued
 * events are retried through the normal pipeline.
 *
 * Design goals:
 *   - Zero dependencies (Web Storage + navigator.onLine)
 *   - Bounded storage (max 100 events; oldest are evicted when full)
 *   - Idempotent: each event has a unique event_id — no double-sends
 *   - Auto-flush when the browser goes back online
 *
 * Usage:
 *   import { eventQueue } from '@/lib/capi/queue';
 *
 *   // Enqueue a failed event for retry
 *   eventQueue.enqueue(event, providerId, authToken);
 *
 *   // Manually flush (e.g. on app startup)
 *   await eventQueue.flush(trackFn);
 */

import type { AtlasEvent } from '@/types/capi';

const QUEUE_STORAGE_KEY = 'atlas_capi_queue';
const MAX_QUEUE_SIZE = 100;
const MAX_RETRY_COUNT = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueuedEvent {
  event: AtlasEvent;
  provider_id: string;
  auth_token: string;
  enqueued_at: number;      // Unix timestamp (ms)
  retry_count: number;
}

export type FlushCallback = (
  event: AtlasEvent,
  providerId: string,
  authToken: string,
) => Promise<{ status: string }>;

// ── Storage helpers ───────────────────────────────────────────────────────────

function readQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedEvent[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedEvent[]): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage quota exceeded — drop the queue rather than throw
  }
}

function clearQueue(): void {
  try {
    localStorage.removeItem(QUEUE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Queue singleton ───────────────────────────────────────────────────────────

class CAPIEventQueue {
  private flushInProgress = false;
  private onlineHandler: (() => void) | null = null;

  /**
   * Add an event to the retry queue.
   * If the queue is at capacity, the oldest entry is evicted.
   */
  enqueue(event: AtlasEvent, providerId: string, authToken: string): void {
    const items = readQueue();

    // Dedup by event_id
    const existing = items.findIndex((i) => i.event.event_id === event.event_id && i.provider_id === providerId);
    if (existing !== -1) return;

    const entry: QueuedEvent = {
      event,
      provider_id: providerId,
      auth_token: authToken,
      enqueued_at: Date.now(),
      retry_count: 0,
    };

    items.push(entry);

    // Evict oldest if over limit
    while (items.length > MAX_QUEUE_SIZE) {
      items.shift();
    }

    writeQueue(items);
  }

  /**
   * Return the current queue length.
   */
  size(): number {
    return readQueue().length;
  }

  /**
   * Attempt delivery of all queued events.
   * Events that succeed or exceed MAX_RETRY_COUNT are removed from the queue.
   * Events that fail are kept (retry_count incremented).
   *
   * @param callback  Function that attempts delivery of a single event.
   *                  Should resolve to `{ status: 'delivered' | 'failed' | ... }`.
   */
  async flush(callback: FlushCallback): Promise<{ attempted: number; delivered: number; remaining: number }> {
    if (this.flushInProgress) {
      return { attempted: 0, delivered: 0, remaining: this.size() };
    }

    this.flushInProgress = true;
    const items = readQueue();

    if (items.length === 0) {
      this.flushInProgress = false;
      return { attempted: 0, delivered: 0, remaining: 0 };
    }

    let delivered = 0;
    const remaining: QueuedEvent[] = [];

    for (const item of items) {
      try {
        const result = await callback(item.event, item.provider_id, item.auth_token);
        if (result.status === 'delivered') {
          delivered++;
          // Remove from queue — success
        } else {
          item.retry_count++;
          if (item.retry_count < MAX_RETRY_COUNT) {
            remaining.push(item);
          }
          // Exceeds max retries — silently drop
        }
      } catch {
        item.retry_count++;
        if (item.retry_count < MAX_RETRY_COUNT) {
          remaining.push(item);
        }
      }
    }

    if (remaining.length === 0) {
      clearQueue();
    } else {
      writeQueue(remaining);
    }

    this.flushInProgress = false;
    return { attempted: items.length, delivered, remaining: remaining.length };
  }

  /**
   * Remove all entries from the queue (e.g. on sign-out).
   */
  drain(): void {
    clearQueue();
  }

  /**
   * Register an auto-flush callback that fires when the browser comes back online.
   * Call this once at app startup. Pass `null` to deregister.
   *
   * @param callback  The same FlushCallback used in `flush()`.
   */
  listenForReconnect(callback: FlushCallback | null): void {
    // Deregister existing listener
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }

    if (callback) {
      this.onlineHandler = () => {
        void this.flush(callback);
      };
      window.addEventListener('online', this.onlineHandler);
    }
  }

  /**
   * Returns true if the browser is currently offline.
   */
  isOffline(): boolean {
    return typeof navigator !== 'undefined' && !navigator.onLine;
  }
}

// ── Exported singleton ────────────────────────────────────────────────────────

export const eventQueue = new CAPIEventQueue();
