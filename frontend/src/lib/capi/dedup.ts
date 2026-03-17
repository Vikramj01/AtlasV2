/**
 * Client-Side Event Deduplication
 *
 * Tracks event IDs in memory (Map) with a configurable TTL.
 * Prevents the same event from being enqueued twice in rapid succession
 * (e.g., React StrictMode double-firing, navigation races).
 *
 * Server-side dedup (using the capi_events table) is the source of truth.
 * This is a best-effort client guard only.
 *
 * Meta's dedup window: 48 hours (2,880 minutes)
 * For client-side purposes we use a much shorter window (default: 60 seconds)
 * since sessions are short-lived and the server handles the full window.
 */

interface DedupEntry {
  event_id: string;
  expires_at: number; // ms timestamp
}

export class ClientDedup {
  private readonly store = new Map<string, DedupEntry>();
  private readonly windowMs: number;

  constructor(windowSeconds = 60) {
    this.windowMs = windowSeconds * 1000;
  }

  /**
   * Returns true if this event_id was seen within the dedup window.
   * If not seen, registers it and returns false.
   */
  check(eventId: string): boolean {
    this.purgeExpired();
    const entry = this.store.get(eventId);
    if (entry && entry.expires_at > Date.now()) {
      return true; // duplicate
    }
    this.store.set(eventId, {
      event_id: eventId,
      expires_at: Date.now() + this.windowMs,
    });
    return false;
  }

  /** Manually mark an event as seen (without checking). */
  register(eventId: string): void {
    this.store.set(eventId, {
      event_id: eventId,
      expires_at: Date.now() + this.windowMs,
    });
  }

  /** Remove all expired entries. */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expires_at <= now) this.store.delete(key);
    }
  }

  /** Clear all entries (e.g., on user sign-out). */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// Shared singleton for the current browser session
export const clientDedup = new ClientDedup(60);
