/**
 * CAPI Provider Adapter Interface
 *
 * Every conversion API provider (Meta, Google, TikTok, LinkedIn, Snapchat)
 * MUST implement this interface. The core pipeline only depends on this
 * contract — never on provider-specific types.
 *
 * To add a new provider:
 *   1. Create adapters/<provider>.ts
 *   2. Implement CAPIProviderAdapter
 *   3. Register it in the adapter registry (pipeline.ts)
 *
 * Re-exports the relevant types from capi.ts so callers only need
 * one import for the full adapter contract.
 */

export type {
  CAPIProvider,
  CAPIProviderAdapter,
  ProviderCredentials,
  ProviderPayload,
  ValidationResult,
  DeliveryResult,
  TestResult,
  EMQReport,
  AtlasEvent,
  EventMapping,
  HashedIdentifier,
} from '@/types/capi';
