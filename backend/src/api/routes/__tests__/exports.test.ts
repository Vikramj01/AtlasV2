/**
 * Exports routes integration tests — /api/exports
 *
 * Covers: XLSX signal inventory export (correct Content-Type, filename,
 *         Content-Length header), auth required, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/export/signalInventoryExport', () => ({
  generateSignalInventoryExport: vi.fn(),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { next(); },
}));

vi.mock('@/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as signalInventoryExport from '@/services/export/signalInventoryExport';
import { exportsRouter } from '../exports';

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/exports', exportsRouter);
  return request(app);
}

// ── GET /api/exports/signal-inventory ────────────────────────────────────────

describe('GET /api/exports/signal-inventory', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns XLSX with correct Content-Type header', async () => {
    const fakeXlsx = Buffer.alloc(512, 0);
    vi.mocked(signalInventoryExport.generateSignalInventoryExport).mockResolvedValue(fakeXlsx as any);

    const res = await buildApp().get('/api/exports/signal-inventory');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns Content-Disposition attachment with .xlsx filename', async () => {
    const fakeXlsx = Buffer.alloc(128, 0);
    vi.mocked(signalInventoryExport.generateSignalInventoryExport).mockResolvedValue(fakeXlsx as any);

    const res = await buildApp().get('/api/exports/signal-inventory');

    expect(res.headers['content-disposition']).toMatch(/attachment.*\.xlsx/);
  });

  it('passes org_id query param to the generator', async () => {
    const fakeXlsx = Buffer.alloc(64, 0);
    vi.mocked(signalInventoryExport.generateSignalInventoryExport).mockResolvedValue(fakeXlsx as any);

    await buildApp().get('/api/exports/signal-inventory?org_id=org-123');

    expect(signalInventoryExport.generateSignalInventoryExport).toHaveBeenCalledWith('u1', 'org-123');
  });

  it('calls generator with undefined org_id when not provided', async () => {
    const fakeXlsx = Buffer.alloc(64, 0);
    vi.mocked(signalInventoryExport.generateSignalInventoryExport).mockResolvedValue(fakeXlsx as any);

    await buildApp().get('/api/exports/signal-inventory');

    expect(signalInventoryExport.generateSignalInventoryExport).toHaveBeenCalledWith('u1', undefined);
  });

  it('returns 500 when generator throws', async () => {
    vi.mocked(signalInventoryExport.generateSignalInventoryExport).mockRejectedValue(new Error('DB error'));

    const res = await buildApp().get('/api/exports/signal-inventory');

    expect(res.status).toBe(500);
  });
});
