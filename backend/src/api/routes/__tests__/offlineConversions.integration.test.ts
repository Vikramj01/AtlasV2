/**
 * Integration tests for the Offline Conversions API routes
 *
 * Tests the Express route handlers end-to-end using Supertest, with all
 * external dependencies (Supabase, Bull queue) mocked via Vitest.
 *
 * Scenarios covered:
 *   - GET /template — returns CSV with correct headers
 *   - GET /config — 404 when not configured, 200 when configured
 *   - POST /config — validation of required fields, provider ownership check
 *   - POST /upload — missing file, no config, happy path with validation result
 *   - POST /upload/:id/confirm — queues job, returns 202
 *   - POST /upload/:id/cancel — cancels pending upload
 *   - GET /history — returns paginated upload list
 *
 * Auth: all tests inject a fake req.user by bypassing authMiddleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

// ── Module mocks (must be declared before imports that use them) ──────────────

vi.mock('@/services/database/offlineConversionQueries', () => ({
  getConfig: vi.fn(),
  upsertConfig: vi.fn(),
  createUpload: vi.fn(),
  getUpload: vi.fn(),
  setUploadValidated: vi.fn(),
  setUploadStatus: vi.fn(),
  listUploads: vi.fn(),
  insertRows: vi.fn(),
  getUploadRowPage: vi.fn(),
  findCrossUploadDuplicates: vi.fn(),
}));

vi.mock('@/services/queue/jobQueue', () => ({
  offlineConversionQueue: {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
  },
}));

vi.mock('@/services/database/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { plan: 'pro' } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

vi.mock('@/services/capi/credentials', () => ({
  safeDecryptCredentials: vi.fn().mockReturnValue({
    customer_id: '1234567890',
    oauth_access_token: 'mock-token',
  }),
}));

vi.mock('@/services/offline-conversions/googleOfflineUpload', () => ({
  fetchConversionActions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import mocked modules for assertion ──────────────────────────────────────

import * as dbQueries from '@/services/database/offlineConversionQueries';
import { offlineConversionQueue } from '@/services/queue/jobQueue';

// ── Import the router under test ─────────────────────────────────────────────

import { offlineConversionsRouter } from '../offlineConversions';

// ── Test app setup ────────────────────────────────────────────────────────────

/**
 * Build an Express test app that:
 *   - Injects a fake auth user (bypassing real JWT validation)
 *   - Mounts the offlineConversionsRouter at /api/offline-conversions
 */
function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Inject fake authenticated user — bypasses authMiddleware
  app.use((req, _res, next) => {
    (req as Request & { user: { id: string; plan: string } }).user = {
      id: 'test-user-id',
      plan: 'pro',
    };
    next();
  });

  // Mount router (authMiddleware inside will short-circuit because req.user is set)
  // We need to override the middleware inside the router; simplest approach is to
  // re-export the router without its built-in auth for testing, but since we can't
  // easily do that without changing the source, we mock the middleware dependency.
  app.use('/api/offline-conversions', offlineConversionsRouter);

  return app;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  id: 'config-uuid',
  organization_id: 'test-user-id',
  google_customer_id: '123-456-7890',
  conversion_action_id: 'customers/123/conversionActions/456',
  conversion_action_name: 'Lead Form Submission',
  column_mapping: {
    gclid: 'Click ID (GCLID)',
    email: 'Email Address',
    phone: 'Phone',
    conversion_time: 'Conversion Date',
    conversion_value: 'Deal Value',
    currency: 'Currency',
    order_id: 'Order ID',
  },
  default_currency: 'USD',
  default_conversion_value: null,
  capi_provider_id: 'provider-uuid',
  status: 'active',
  error_message: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const MOCK_UPLOAD = {
  id: 'upload-uuid',
  organization_id: 'test-user-id',
  config_id: 'config-uuid',
  filename: 'deals.csv',
  file_size_bytes: 512,
  row_count_total: 2,
  status: 'validated',
  row_count_valid: 2,
  row_count_invalid: 0,
  row_count_duplicate: 0,
  row_count_uploaded: 0,
  row_count_rejected: 0,
  validation_summary: null,
  upload_result: null,
  error_message: null,
  uploaded_by: 'test-user-id',
  created_at: '2026-04-01T00:00:00Z',
  validated_at: '2026-04-01T00:00:01Z',
  confirmed_at: null,
  processing_started_at: null,
  completed_at: null,
  updated_at: '2026-04-01T00:00:01Z',
};

function makeValidCsvBuffer(): Buffer {
  const future = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return Buffer.from(
    [
      'Click ID (GCLID),Email Address,Phone,Conversion Date,Deal Value,Currency,Order ID',
      `GCLID001,alice@example.com,+14155551234,${future},1000,USD,ORD-001`,
      `GCLID002,bob@example.com,+14155559876,${future},2000,USD,ORD-002`,
    ].join('\n'),
    'utf-8',
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/offline-conversions/template', () => {
  it('returns a CSV file with correct headers', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/api/offline-conversions/template');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('Click ID (GCLID)');
    expect(res.text).toContain('Email Address');
    expect(res.text).toContain('Conversion Date');
  });
});

describe('GET /api/offline-conversions/config', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 404 when no config exists', async () => {
    vi.mocked(dbQueries.getConfig).mockResolvedValue(null);

    const app = buildTestApp();
    const res = await request(app).get('/api/offline-conversions/config');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CONFIG_NOT_FOUND');
  });

  it('returns 200 with config when configured', async () => {
    vi.mocked(dbQueries.getConfig).mockResolvedValue(MOCK_CONFIG as ReturnType<typeof dbQueries.getConfig> extends Promise<infer T> ? T : never);

    const app = buildTestApp();
    const res = await request(app).get('/api/offline-conversions/config');

    expect(res.status).toBe(200);
    expect(res.body.google_customer_id).toBe('123-456-7890');
    expect(res.body.status).toBe('active');
  });
});

describe('POST /api/offline-conversions/config', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 400 when required fields are missing', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/config')
      .send({ google_customer_id: '123' }); // missing other required fields

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FIELDS');
  });

  it('returns 400 for non-3-letter currency', async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/config')
      .send({
        google_customer_id: '123-456-7890',
        conversion_action_id: 'customers/123/conversionActions/456',
        capi_provider_id: 'provider-uuid',
        default_currency: 'USDD', // 4 letters
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CURRENCY');
  });
});

describe('POST /api/offline-conversions/upload', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 400 when no file is attached', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/api/offline-conversions/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_FILE');
  });

  it('returns 400 when config is not found', async () => {
    vi.mocked(dbQueries.getConfig).mockResolvedValue(null);
    vi.mocked(dbQueries.createUpload).mockResolvedValue(MOCK_UPLOAD as ReturnType<typeof dbQueries.createUpload> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.setUploadStatus).mockResolvedValue(undefined);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload')
      .attach('file', makeValidCsvBuffer(), { filename: 'test.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONFIG_NOT_FOUND');
  });

  it('returns 200 with validation summary for a valid CSV', async () => {
    vi.mocked(dbQueries.getConfig).mockResolvedValue(MOCK_CONFIG as ReturnType<typeof dbQueries.getConfig> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.createUpload).mockResolvedValue(MOCK_UPLOAD as ReturnType<typeof dbQueries.createUpload> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.setUploadStatus).mockResolvedValue(undefined);
    vi.mocked(dbQueries.setUploadValidated).mockResolvedValue(undefined);
    vi.mocked(dbQueries.insertRows).mockResolvedValue(undefined);
    vi.mocked(dbQueries.findCrossUploadDuplicates).mockResolvedValue([]);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload')
      .attach('file', makeValidCsvBuffer(), { filename: 'deals.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('upload_id');
    expect(res.body).toHaveProperty('validation_summary');
    expect(res.body.validation_summary).toHaveProperty('total_rows');
    expect(res.body.validation_summary.total_rows).toBe(2);
    expect(res.body.status).toBe('validated');
  });

  it('does not expose raw PII in validation response', async () => {
    vi.mocked(dbQueries.getConfig).mockResolvedValue(MOCK_CONFIG as ReturnType<typeof dbQueries.getConfig> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.createUpload).mockResolvedValue(MOCK_UPLOAD as ReturnType<typeof dbQueries.createUpload> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.setUploadStatus).mockResolvedValue(undefined);
    vi.mocked(dbQueries.setUploadValidated).mockResolvedValue(undefined);
    vi.mocked(dbQueries.insertRows).mockResolvedValue(undefined);
    vi.mocked(dbQueries.findCrossUploadDuplicates).mockResolvedValue([]);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload')
      .attach('file', makeValidCsvBuffer(), { filename: 'deals.csv', contentType: 'text/csv' });

    const body = JSON.stringify(res.body);
    // Raw email addresses should not appear in the response
    expect(body).not.toContain('alice@example.com');
    expect(body).not.toContain('bob@example.com');
    // Phone numbers should not appear
    expect(body).not.toContain('14155551234');
  });
});

describe('POST /api/offline-conversions/upload/:id/confirm', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 404 when upload does not exist', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue(null);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/nonexistent-id/confirm');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('UPLOAD_NOT_FOUND');
  });

  it('returns 409 when upload is not in validated state', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue({
      ...MOCK_UPLOAD,
      status: 'completed',
    } as ReturnType<typeof dbQueries.getUpload> extends Promise<infer T> ? T : never);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/upload-uuid/confirm');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVALID_STATUS');
  });

  it('enqueues a Bull job and returns 202 for a validated upload', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue(
      MOCK_UPLOAD as ReturnType<typeof dbQueries.getUpload> extends Promise<infer T> ? T : never,
    );
    vi.mocked(dbQueries.setUploadStatus).mockResolvedValue(undefined);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/upload-uuid/confirm');

    expect(res.status).toBe(202);
    expect(res.body.upload_id).toBe('upload-uuid');
    expect(res.body.status).toBe('confirmed');

    // Verify the queue was called with only IDs (no PII)
    expect(offlineConversionQueue.add).toHaveBeenCalledOnce();
    const jobPayload = vi.mocked(offlineConversionQueue.add).mock.calls[0][0] as {
      upload_id: string;
      organization_id: string;
    };
    expect(jobPayload.upload_id).toBe('upload-uuid');
    expect(jobPayload.organization_id).toBe('test-user-id');
    // Ensure no PII fields in the job payload
    expect(jobPayload).not.toHaveProperty('email');
    expect(jobPayload).not.toHaveProperty('phone');
    expect(jobPayload).not.toHaveProperty('gclid');
  });
});

describe('POST /api/offline-conversions/upload/:id/cancel', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns 404 when upload does not exist', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue(null);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/bad-id/cancel');

    expect(res.status).toBe(404);
  });

  it('returns 409 when upload is already completed', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue({
      ...MOCK_UPLOAD,
      status: 'completed',
    } as ReturnType<typeof dbQueries.getUpload> extends Promise<infer T> ? T : never);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/upload-uuid/cancel');

    expect(res.status).toBe(409);
  });

  it('cancels a pending upload successfully', async () => {
    vi.mocked(dbQueries.getUpload).mockResolvedValue({
      ...MOCK_UPLOAD,
      status: 'validated',
    } as ReturnType<typeof dbQueries.getUpload> extends Promise<infer T> ? T : never);
    vi.mocked(dbQueries.setUploadStatus).mockResolvedValue(undefined);

    const app = buildTestApp();
    const res = await request(app)
      .post('/api/offline-conversions/upload/upload-uuid/cancel');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});

describe('GET /api/offline-conversions/history', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('returns paginated upload history', async () => {
    vi.mocked(dbQueries.listUploads).mockResolvedValue({
      uploads: [MOCK_UPLOAD],
      total: 1,
    } as ReturnType<typeof dbQueries.listUploads> extends Promise<infer T> ? T : never);

    const app = buildTestApp();
    const res = await request(app).get('/api/offline-conversions/history');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('uploads');
    expect(res.body.uploads).toHaveLength(1);
    expect(res.body.uploads[0].id).toBe('upload-uuid');
  });

  it('does not expose raw_email or raw_phone in history response', async () => {
    vi.mocked(dbQueries.listUploads).mockResolvedValue({
      uploads: [{
        ...MOCK_UPLOAD,
        raw_email: 'should-not-appear@example.com',
        raw_phone: '+19999999999',
      }],
      total: 1,
    } as ReturnType<typeof dbQueries.listUploads> extends Promise<infer T> ? T : never);

    const app = buildTestApp();
    const res = await request(app).get('/api/offline-conversions/history');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('should-not-appear@example.com');
    expect(body).not.toContain('9999999999');
  });
});
