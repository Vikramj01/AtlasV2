/**
 * Signal Enrichment routes
 *
 * /api/organisations/:orgId/clients/:clientId/identity-config
 * /api/organisations/:orgId/clients/:clientId/validate-field-path
 * /api/organisations/:orgId/clients/:clientId/enrichment-score
 * /api/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment
 * /api/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment/:signalKey
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { getOrgMembership } from '@/services/database/orgQueries';
import { getClient } from '@/services/database/clientQueries';
import {
  getClientIdentityConfig,
  upsertClientIdentityConfig,
  updateIdentityConfigScore,
  listSignalEnrichmentConfigs,
  getSignalEnrichmentConfig,
  upsertSignalEnrichmentConfig,
  dbRowToSignalEnrichmentConfig,
} from '@/services/database/enrichmentQueries';
import {
  validateFieldPathSyntax,
  resolveFieldPath,
  validateSignalEnrichment,
  computeClientEnrichmentScore,
} from '@/services/enrichment/enrichmentConfigService';

const router = Router({ mergeParams: true });
router.use(authMiddleware);

// ─── Helper: verify user belongs to org and client belongs to org ─────────────

async function assertClientAccess(
  orgId: string,
  clientId: string,
  userId: string,
  res: Response,
): Promise<boolean> {
  const membership = await getOrgMembership(orgId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this organisation' });
    return false;
  }
  const client = await getClient(clientId, orgId);
  if (!client || client.organisation_id !== orgId) {
    res.status(404).json({ error: 'Client not found' });
    return false;
  }
  return true;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const IdentityConfigSchema = z.object({
  email_field: z.string().nullable().optional(),
  phone_field: z.string().nullable().optional(),
  first_name_field: z.string().nullable().optional(),
  last_name_field: z.string().nullable().optional(),
  postal_code_field: z.string().nullable().optional(),
  country_field: z.string().nullable().optional(),
  external_id_field: z.string().nullable().optional(),
  fbc_field: z.string().optional(),
  fbp_field: z.string().optional(),
  gclid_field: z.string().optional(),
  wbraid_field: z.string().optional(),
  gbraid_field: z.string().optional(),
  auto_capture_ip: z.boolean().optional(),
  auto_capture_ua: z.boolean().optional(),
  enabled_identifiers: z.array(z.string()).optional(),
});

const ValueConfigSchema = z.object({
  field: z.string().min(1),
  includes_tax: z.boolean(),
  includes_shipping: z.boolean(),
}).nullable();

const CurrencyConfigSchema = z.object({
  mode: z.enum(['static', 'dynamic']),
  field: z.string().optional(),
  static_value: z.string().optional(),
}).nullable();

const DedupConfigSchema = z.object({
  field: z.string().min(1),
}).nullable();

const ContentConfigSchema = z.object({
  ids_field: z.string().optional(),
  ids_path_type: z.enum(['array', 'string', 'nested']),
  num_items_field: z.string().optional(),
}).nullable();

const SignalEnrichmentSchema = z.object({
  deployment_id: z.string().uuid(),
  signal_key: z.string().min(1),
  value_config: ValueConfigSchema,
  currency_config: CurrencyConfigSchema,
  dedup_config: DedupConfigSchema,
  content_config: ContentConfigSchema,
  enabled_for_meta: z.boolean(),
  enabled_for_google: z.boolean(),
});

const ValidateFieldPathSchema = z.object({
  field_path: z.string().min(1),
  sample_event: z.record(z.unknown()).optional(),
});

// ─── GET /identity-config ─────────────────────────────────────────────────────

router.get(
  '/organisations/:orgId/clients/:clientId/identity-config',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const config = await getClientIdentityConfig(clientId);
      res.json({ data: config });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── PUT /identity-config ─────────────────────────────────────────────────────

router.put(
  '/organisations/:orgId/clients/:clientId/identity-config',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const parsed = IdentityConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_BODY', message: parsed.error.message });
        return;
      }

      const config = await upsertClientIdentityConfig({
        ...parsed.data,
        client_id: clientId,
        enabled_identifiers: parsed.data.enabled_identifiers as import('@/types/enrichment').SaveIdentityConfigRequest['enabled_identifiers'],
      });
      res.json({ data: config });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── POST /identity-config/validate ──────────────────────────────────────────

router.post(
  '/organisations/:orgId/clients/:clientId/identity-config/validate',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const config = await getClientIdentityConfig(clientId);
      if (!config) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'No identity config found for this client' });
        return;
      }

      // Score is computed by counting enabled + mapped identifiers
      const enabled = new Set(config.enabled_identifiers);
      let score = 0;
      if (enabled.has('email') && config.email_field) score += 35;
      if (enabled.has('phone') && config.phone_field) score += 20;
      if (enabled.has('fbc') && config.fbc_field) score += 15;
      if (enabled.has('fbp') && config.fbp_field) score += 10;
      if (enabled.has('gclid') && config.gclid_field) score += 10;
      if (config.auto_capture_ip) score += 5;
      if (config.auto_capture_ua) score += 5;

      await updateIdentityConfigScore(clientId, score);

      res.json({ data: { score, identity_score: score } });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── GET /enrichment-score ────────────────────────────────────────────────────

router.get(
  '/organisations/:orgId/clients/:clientId/enrichment-score',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const identityConfig = await getClientIdentityConfig(clientId);

      // Gather all enrichment configs for all deployments under this client
      const { supabaseAdmin: supabase } = await import('@/services/database/supabase');
      const { data: deployments } = await supabase
        .from('deployments')
        .select('id')
        .eq('client_id', clientId);

      const deploymentIds = (deployments ?? []).map((d: { id: string }) => d.id);
      let allEnrichments: import('@/types/enrichment').SignalEnrichmentConfig[] = [];
      for (const depId of deploymentIds) {
        const configs = await listSignalEnrichmentConfigs(depId);
        allEnrichments = allEnrichments.concat(configs);
      }

      const score = computeClientEnrichmentScore(identityConfig, allEnrichments);
      res.json({ data: score });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── POST /validate-field-path ────────────────────────────────────────────────

router.post(
  '/organisations/:orgId/clients/:clientId/validate-field-path',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const parsed = ValidateFieldPathSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_BODY', message: parsed.error.message });
        return;
      }

      const { field_path, sample_event } = parsed.data;

      if (!validateFieldPathSyntax(field_path)) {
        res.json({
          data: {
            valid: false,
            error: 'Field path contains invalid characters. Use dot notation (e.g. ecommerce.purchase.actionField.revenue)',
          },
        });
        return;
      }

      let resolved_value: unknown;
      if (sample_event) {
        resolved_value = resolveFieldPath(sample_event, field_path);
      }

      res.json({
        data: {
          valid: true,
          resolved_value,
          path_syntax: 'valid',
        },
      });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── GET /deployments/:deploymentId/enrichment ────────────────────────────────

router.get(
  '/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId, deploymentId } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const configs = await listSignalEnrichmentConfigs(deploymentId);
      res.json({ data: configs });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── PUT /deployments/:deploymentId/enrichment/:signalKey ─────────────────────

router.put(
  '/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment/:signalKey',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId, deploymentId, signalKey } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const parsed = SignalEnrichmentSchema.safeParse({
        ...req.body,
        deployment_id: deploymentId,
        signal_key: signalKey,
      });
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_BODY', message: parsed.error.message });
        return;
      }

      // Validate and compute score before saving
      const tempConfig = {
        id: '',
        deployment_id: deploymentId,
        signal_key: signalKey,
        value_config: parsed.data.value_config,
        currency_config: parsed.data.currency_config,
        dedup_config: parsed.data.dedup_config,
        content_config: parsed.data.content_config,
        enabled_for_meta: parsed.data.enabled_for_meta,
        enabled_for_google: parsed.data.enabled_for_google,
        validated_at: null,
        validation_score: null,
        validation_warnings: [],
        created_at: '',
        updated_at: '',
      };
      const validation = validateSignalEnrichment(tempConfig);

      const config = await upsertSignalEnrichmentConfig(
        parsed.data,
        validation.score,
        validation.warnings,
      );
      res.json({ data: config, validation });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ─── POST /deployments/:deploymentId/enrichment/:signalKey/validate ───────────

router.post(
  '/organisations/:orgId/clients/:clientId/deployments/:deploymentId/enrichment/:signalKey/validate',
  async (req: Request, res: Response) => {
    try {
      const { orgId, clientId, deploymentId, signalKey } = req.params;
      const userId = req.user!.id;
      if (!(await assertClientAccess(orgId, clientId, userId, res))) return;

      const config = await getSignalEnrichmentConfig(deploymentId, signalKey);
      if (!config) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'No enrichment config found for this signal' });
        return;
      }

      const validation = validateSignalEnrichment(config);
      res.json({ data: validation });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

export { router as enrichmentRouter };
