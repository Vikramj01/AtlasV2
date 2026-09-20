/**
 * The deterministic outcome idempotency key (§9.2) — one tiny, dependency-free
 * module so both syncOrchestrator.ts (pull) and webhookIngest.ts (push,
 * Phase 3) compute the exact same value the exact same way, without either
 * one importing the other's much heavier module (syncOrchestrator.ts pulls
 * in outcomeDelivery.ts's full transitive dependency tree — tokenManager,
 * capiQueries, every CAPI delivery module — none of which a pure hash
 * function has any business depending on).
 */
import { createHash } from 'crypto';

export function computeEventId(configId: string, sourceRecordId: string, sourceStageId: string): string {
  return createHash('sha256').update(`${configId}:${sourceRecordId}:${sourceStageId}`).digest('hex').slice(0, 32);
}
