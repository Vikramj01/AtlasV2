/**
 * Offline Conversion Upload API routes — all endpoints under /api/offline-conversions
 *
 * GET    /api/offline-conversions/template              — download CSV template
 * GET    /api/offline-conversions/config                — get current config
 * POST   /api/offline-conversions/config                — create / update config
 * GET    /api/offline-conversions/conversion-actions    — list Google Ads conversion actions
 * POST   /api/offline-conversions/upload                — upload CSV, run validation, return summary
 * GET    /api/offline-conversions/upload/:uploadId      — get upload detail + row page
 * POST   /api/offline-conversions/upload/:uploadId/confirm — hash PII + queue for Google upload
 * POST   /api/offline-conversions/upload/:uploadId/cancel  — cancel an upload before confirm
 * GET    /api/offline-conversions/history               — paginated upload history
 *
 * All routes require authMiddleware.
 * File uploads use multer memoryStorage (no disk writes, 10MB limit).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware';
import { planGuard } from '../middleware/planGuard';
import { offlineUploadLimiter } from '../middleware/offlineUploadLimiter';
import { sendInternalError } from '@/utils/apiError';
import {
  getConfig,
  upsertConfig,
  createUpload,
  getUpload,
  setUploadValidated,
  setUploadStatus,
  listUploads,
  insertRows,
  getUploadRowPage,
  findCrossUploadDuplicates,
} from '@/services/database/offlineConversionQueries';
import {
  validateCsvBuffer,
  toInsertInput,
  generateCsvTemplate,
  DEFAULT_COLUMN_MAPPING,
} from '@/services/offline-conversions/csvValidator';
import { fetchConversionActions } from '@/services/offline-conversions/googleOfflineUpload';
import { offlineConversionQueue } from '@/services/queue/jobQueue';
import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import type { GoogleCredentials } from '@/types/capi';
import type { UpsertConfigInput, ValidationSummary } from '@/types/offline-conversions';
import logger from '@/utils/logger';

export const offlineConversionsRouter = Router();

// All routes require auth + agency plan
offlineConversionsRouter.use(authMiddleware, planGuard('agency'));

// ── Multer: in-memory storage, 10MB limit, CSV only ───────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/plain'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Please upload a CSV file.'));
    }
  },
});

// ── GET /api/offline-conversions/template ─────────────────────────────────────

offlineConversionsRouter.get('/template', (_req: Request, res: Response): void => {
  const csv = generateCsvTemplate();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="atlas-offline-conversions-template.csv"');
  res.send(csv);
});

// ── GET /api/offline-conversions/config ───────────────────────────────────────

offlineConversionsRouter.get('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = await getConfig(req.user.id);
    if (!config) {
      res.status(404).json({ error: 'CONFIG_NOT_FOUND', message: 'No offline conversion config found. Complete the setup wizard first.' });
      return;
    }
    res.json(config);
  } catch (err) {
    sendInternalError(res, err, 'Failed to get offline conversion config');
  }
});

// ── POST /api/offline-conversions/config ──────────────────────────────────────

offlineConversionsRouter.post('/config', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<UpsertConfigInput>;

  const providerType = body.provider_type ?? 'google';

  if (!body.capi_provider_id || !body.default_currency) {
    res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'capi_provider_id and default_currency are required',
    });
    return;
  }

  // Provider-specific required fields
  if (providerType === 'google' && (!body.google_customer_id || !body.conversion_action_id)) {
    res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'google_customer_id and conversion_action_id are required for Google provider',
    });
    return;
  }

  if (providerType === 'meta' && !body.meta_event_name) {
    res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'meta_event_name is required for Meta provider',
    });
    return;
  }

  if (body.default_currency.length !== 3) {
    res.status(400).json({ error: 'INVALID_CURRENCY', message: 'default_currency must be a 3-letter ISO 4217 code' });
    return;
  }

  // Verify the capi_provider belongs to this user and matches the provider type
  const { data: provider, error: providerErr } = await supabaseAdmin
    .from('capi_providers')
    .select('id, provider')
    .eq('id', body.capi_provider_id)
    .eq('organization_id', req.user.id)
    .maybeSingle();

  if (providerErr || !provider) {
    res.status(400).json({ error: 'INVALID_PROVIDER', message: 'CAPI provider not found or does not belong to your account' });
    return;
  }

  if (provider.provider !== providerType) {
    res.status(400).json({
      error: 'INVALID_PROVIDER',
      message: `Selected CAPI provider is a "${provider.provider}" provider but config specifies "${providerType}"`,
    });
    return;
  }

  try {
    const config = await upsertConfig({
      organization_id: req.user.id,
      provider_type: providerType,
      capi_provider_id: body.capi_provider_id,
      // Google-specific (null for Meta)
      google_customer_id: body.google_customer_id ?? null,
      conversion_action_id: body.conversion_action_id ?? null,
      conversion_action_name: body.conversion_action_name ?? null,
      // Meta-specific (null for Google)
      meta_event_name: body.meta_event_name ?? null,
      column_mapping: body.column_mapping ?? DEFAULT_COLUMN_MAPPING,
      default_currency: body.default_currency.toUpperCase(),
      default_conversion_value: body.default_conversion_value ?? null,
    });
    res.status(201).json(config);
  } catch (err) {
    sendInternalError(res, err, 'Failed to save offline conversion config');
  }
});

// ── GET /api/offline-conversions/conversion-actions ───────────────────────────

offlineConversionsRouter.get('/conversion-actions', async (req: Request, res: Response): Promise<void> => {
  const { provider_id } = req.query as { provider_id?: string };

  if (!provider_id) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'provider_id query parameter is required' });
    return;
  }

  try {
    const { data: provider, error: providerErr } = await supabaseAdmin
      .from('capi_providers')
      .select('credentials, provider')
      .eq('id', provider_id)
      .eq('organization_id', req.user.id)
      .maybeSingle();

    if (providerErr || !provider) {
      res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
      return;
    }

    if (provider.provider !== 'google') {
      res.status(400).json({ error: 'INVALID_PROVIDER', message: 'Only Google CAPI providers support conversion action listing' });
      return;
    }

    const creds = safeDecryptCredentials(provider.credentials) as GoogleCredentials;
    const actions = await fetchConversionActions(creds);
    // Return customer_id so frontend can store it in the wizard draft
    res.json({ actions, customer_id: creds.customer_id });
  } catch (err) {
    sendInternalError(res, err, 'Failed to fetch conversion actions');
  }
});

// ── POST /api/offline-conversions/upload ──────────────────────────────────────
// Accepts a CSV file, runs validation, stores rows, returns summary.
// Does NOT hash PII or send to Google — that happens on /confirm.

offlineConversionsRouter.post(
  '/upload',
  offlineUploadLimiter,
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'FILE_TOO_LARGE', message: 'File exceeds 10MB limit. Split data into smaller files.' });
        return;
      }
      if (err) {
        res.status(400).json({ error: 'INVALID_FILE', message: err.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'MISSING_FILE', message: 'Please upload a CSV file.' });
      return;
    }

    if (req.file.size === 0) {
      res.status(400).json({ error: 'EMPTY_FILE', message: 'The uploaded file is empty.' });
      return;
    }

    try {
      const config = await getConfig(req.user.id);
      if (!config) {
        res.status(400).json({ error: 'CONFIG_NOT_FOUND', message: 'Complete the setup wizard before uploading.' });
        return;
      }

      if (config.status !== 'active') {
        res.status(400).json({ error: 'CONFIG_NOT_ACTIVE', message: `Offline conversion config is ${config.status}. Check your ad platform connection.` });
        return;
      }

      // ── Create upload record ──────────────────────────────────────────────

      const uploadRecord = await createUpload({
        organization_id: req.user.id,
        config_id: config.id,
        filename: req.file.originalname,
        file_size_bytes: req.file.size,
        uploaded_by: req.user.id,
      });

      await setUploadStatus(uploadRecord.id, 'validating');

      // ── Validate CSV ──────────────────────────────────────────────────────

      let validationResult;
      try {
        validationResult = validateCsvBuffer(
          req.file.buffer,
          config.column_mapping,
          config.default_currency,
          config.default_conversion_value,
        );
      } catch (parseErr) {
        await setUploadStatus(uploadRecord.id, 'failed', {
          error_message: parseErr instanceof Error ? parseErr.message : 'CSV parse error',
        });
        res.status(400).json({
          error: 'PARSE_ERROR',
          message: parseErr instanceof Error ? parseErr.message : 'Failed to parse CSV file',
        });
        return;
      }

      if (validationResult.rows.length === 0) {
        await setUploadStatus(uploadRecord.id, 'failed', { error_message: 'No valid rows found' });
        res.status(400).json({ error: 'EMPTY_FILE', message: 'No valid rows found. Fix errors in CSV and retry.' });
        return;
      }

      // ── Cross-upload duplicate check ──────────────────────────────────────

      const orderIds = validationResult.rows
        .filter((r) => r.orderId && r.status === 'valid')
        .map((r) => r.orderId!);
      const hashedEmailsForDedup: string[] = []; // We don't hash at this stage — skip cross-upload email dedup for now

      const crossDupes = await findCrossUploadDuplicates(
        req.user.id,
        orderIds,
        hashedEmailsForDedup,
        uploadRecord.id,
      );

      // Mark rows with cross-upload duplicate order IDs
      let crossDupeCount = 0;
      for (const row of validationResult.rows) {
        if (row.status === 'valid' && row.orderId && crossDupes.orderIds.has(row.orderId)) {
          row.status = 'duplicate';
          row.errors.push({
            row: row.rowIndex,
            field: 'order_id',
            code: 'CROSS_UPLOAD_DUPLICATE',
            message: `Order ID "${row.orderId}" was already uploaded in a previous batch.`,
          });
          crossDupeCount++;
        }
      }

      const finalValidCount = validationResult.validCount - crossDupeCount;
      const finalDupeCount = validationResult.duplicateCount + crossDupeCount;

      if (finalValidCount === 0 && finalDupeCount > 0) {
        await setUploadStatus(uploadRecord.id, 'failed', { error_message: 'All rows already uploaded' });
        res.status(400).json({ error: 'ALL_DUPLICATES', message: 'All rows already uploaded. No new conversions to process.' });
        return;
      }

      // ── Persist rows to DB ────────────────────────────────────────────────

      const insertInputs = validationResult.rows.map((row) =>
        toInsertInput(row, uploadRecord.id, req.user.id),
      );
      await insertRows(insertInputs);

      // ── Build validation summary ──────────────────────────────────────────

      const summary: ValidationSummary = {
        total_rows: validationResult.rows.length,
        valid_rows: finalValidCount,
        invalid_rows: validationResult.invalidCount,
        duplicate_rows: finalDupeCount,
        errors: validationResult.allErrors.slice(0, 100),   // cap at 100 for response size
        warnings: validationResult.allWarnings.slice(0, 100),
      };

      await setUploadValidated(
        uploadRecord.id,
        summary,
        finalValidCount,
        validationResult.invalidCount,
        finalDupeCount,
        validationResult.rows.length,
      );

      // ── Return validation summary + error sample ──────────────────────────

      const errorSample = await getUploadRowPage(uploadRecord.id, 1, 20, ['invalid', 'duplicate']);

      res.status(201).json({
        upload_id: uploadRecord.id,
        status: 'validated',
        validation_summary: summary,
        error_sample: errorSample.rows,
      });
    } catch (err) {
      sendInternalError(res, err, 'Failed to process CSV upload');
    }
  },
);

// ── GET /api/offline-conversions/upload/:uploadId ─────────────────────────────

offlineConversionsRouter.get('/upload/:uploadId', async (req: Request, res: Response): Promise<void> => {
  const { page = '1', page_size = '50', status } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(page_size, 10)));

  try {
    const uploadRecord = await getUpload(req.params.uploadId, req.user.id);
    if (!uploadRecord) {
      res.status(404).json({ error: 'UPLOAD_NOT_FOUND' });
      return;
    }

    const statusFilter = status ? (status.split(',') as import('@/types/offline-conversions').OfflineRowStatus[]) : undefined;
    const { rows, total } = await getUploadRowPage(req.params.uploadId, pageNum, pageSize, statusFilter);

    res.json({ upload: uploadRecord, rows, total_rows: total });
  } catch (err) {
    sendInternalError(res, err, 'Failed to get upload detail');
  }
});

// ── POST /api/offline-conversions/upload/:uploadId/confirm ───────────────────
// Queues the upload for Google Ads processing. PII is hashed inside the worker.

offlineConversionsRouter.post('/upload/:uploadId/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const uploadRecord = await getUpload(req.params.uploadId, req.user.id);
    if (!uploadRecord) {
      res.status(404).json({ error: 'UPLOAD_NOT_FOUND' });
      return;
    }

    if (uploadRecord.status !== 'validated') {
      res.status(400).json({
        error: 'INVALID_STATE',
        message: `Upload is in "${uploadRecord.status}" state — only "validated" uploads can be confirmed`,
      });
      return;
    }

    if (uploadRecord.row_count_valid === 0) {
      res.status(400).json({ error: 'NO_VALID_ROWS', message: 'No valid rows to upload. Fix validation errors and re-upload.' });
      return;
    }

    await setUploadStatus(req.params.uploadId, 'confirmed', {
      confirmed_at: new Date().toISOString(),
    });

    await offlineConversionQueue.add({
      upload_id: req.params.uploadId,
      organization_id: req.user.id,
    });

    logger.info({ upload_id: req.params.uploadId, userId: req.user.id }, 'Offline conversion upload confirmed and queued');

    res.json({
      upload_id: req.params.uploadId,
      status: 'confirmed',
      message: `${uploadRecord.row_count_valid} conversions queued for upload. Processing typically completes within 24 hours.`,
    });
  } catch (err) {
    sendInternalError(res, err, 'Failed to confirm upload');
  }
});

// ── POST /api/offline-conversions/upload/:uploadId/cancel ────────────────────

offlineConversionsRouter.post('/upload/:uploadId/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const uploadRecord = await getUpload(req.params.uploadId, req.user.id);
    if (!uploadRecord) {
      res.status(404).json({ error: 'UPLOAD_NOT_FOUND' });
      return;
    }

    const cancellableStatuses = ['pending', 'validating', 'validated'];
    if (!cancellableStatuses.includes(uploadRecord.status)) {
      res.status(400).json({
        error: 'INVALID_STATE',
        message: `Upload cannot be cancelled in "${uploadRecord.status}" state`,
      });
      return;
    }

    await setUploadStatus(req.params.uploadId, 'cancelled');

    res.json({ upload_id: req.params.uploadId, status: 'cancelled' });
  } catch (err) {
    sendInternalError(res, err, 'Failed to cancel upload');
  }
});

// ── GET /api/offline-conversions/history ─────────────────────────────────────

offlineConversionsRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  const { page = '1', page_size = '20' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(page_size, 10)));

  try {
    const { uploads, total } = await listUploads(req.user.id, pageNum, pageSize);
    res.json({ uploads, total, page: pageNum, page_size: pageSize });
  } catch (err) {
    sendInternalError(res, err, 'Failed to get upload history');
  }
});
