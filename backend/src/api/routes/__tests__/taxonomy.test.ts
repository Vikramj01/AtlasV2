/**
 * Taxonomy routes integration tests — /api/taxonomy
 *
 * Covers: tree, events list, search (min-length validation), platform-mapping 404,
 *         create event (201, naming convention 422, duplicate 409),
 *         create category, GET/:id 404, PUT system node 403,
 *         DELETE system node 403, DELETE with linked signals 409.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/database/taxonomyQueries', () => ({
  fetchTaxonomyFlat: vi.fn(),
  fetchTaxonomyEvents: vi.fn(),
  fetchTaxonomyNode: vi.fn(),
  searchTaxonomy: vi.fn(),
  fetchPlatformMapping: vi.fn(),
  createCustomTaxonomyEvent: vi.fn(),
  createCustomTaxonomyCategory: vi.fn(),
  updateTaxonomyNode: vi.fn(),
  deprecateTaxonomyNode: vi.fn(),
  countSignalsForTaxonomyEvent: vi.fn(),
}));

vi.mock('@/services/database/namingConventionQueries', () => ({
  getNamingConvention: vi.fn().mockResolvedValue({ event_case: 'snake_case' }),
}));

vi.mock('@/services/signals/taxonomyTreeBuilder', () => ({
  buildTree: vi.fn().mockReturnValue([]),
}));

vi.mock('@/services/signals/namingConvention', () => ({
  validateEventName: vi.fn().mockReturnValue({ valid: true, errors: [], suggestions: [] }),
}));

vi.mock('@/api/middleware/authMiddleware', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@/utils/apiError', () => ({
  sendInternalError: (res: any, _err: any) => res.status(500).json({ error: 'Internal server error' }),
}));

vi.mock('@/config/env', () => ({
  env: { SUPER_ADMIN_EMAILS: [], ADMIN_EMAILS: [] },
}));

import * as taxonomyQueries from '@/services/database/taxonomyQueries';
import * as namingConvention from '@/services/signals/namingConvention';
import { taxonomyRouter } from '../taxonomy';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_NODE = {
  id: 'node-001',
  slug: 'purchase',
  name: 'Purchase',
  is_system: false,
  node_type: 'event',
  path: 'ecommerce.purchase',
};

const SYSTEM_NODE = { ...MOCK_NODE, id: 'sys-001', is_system: true };

const CREATE_EVENT_BODY = {
  organization_id: '00000000-0000-0000-0000-000000000001',
  parent_path: 'ecommerce',
  slug: 'purchase',
  name: 'Purchase',
  description: 'User completes a purchase',
  parameter_schema: { required: [], optional: [] },
};

function buildApp() {
  const app = express();
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', email: 'user@test.com', plan: 'pro', isSuperAdmin: false };
    next();
  });
  app.use(express.json());
  app.use('/api/taxonomy', taxonomyRouter);
  return request(app);
}

// ── GET /api/taxonomy/tree ────────────────────────────────────────────────────

describe('GET /api/taxonomy/tree', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns taxonomy tree', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyFlat).mockResolvedValue([] as any);

    const res = await buildApp().get('/api/taxonomy/tree');

    expect(res.status).toBe(200);
    expect(res.body.tree).toBeDefined();
  });
});

// ── GET /api/taxonomy/events ──────────────────────────────────────────────────

describe('GET /api/taxonomy/events', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns flat events list', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyEvents).mockResolvedValue([MOCK_NODE] as any);

    const res = await buildApp().get('/api/taxonomy/events');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });
});

// ── GET /api/taxonomy/search ──────────────────────────────────────────────────

describe('GET /api/taxonomy/search', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns search results', async () => {
    vi.mocked(taxonomyQueries.searchTaxonomy).mockResolvedValue([MOCK_NODE] as any);

    const res = await buildApp().get('/api/taxonomy/search?q=purchase');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('returns 400 when query is less than 2 characters', async () => {
    const res = await buildApp().get('/api/taxonomy/search?q=p');

    expect(res.status).toBe(400);
  });

  it('returns 400 when q is missing', async () => {
    const res = await buildApp().get('/api/taxonomy/search');

    expect(res.status).toBe(400);
  });
});

// ── GET /api/taxonomy/platform-mapping/:eventId/:platform ────────────────────

describe('GET /api/taxonomy/platform-mapping/:eventId/:platform', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns platform mapping', async () => {
    vi.mocked(taxonomyQueries.fetchPlatformMapping).mockResolvedValue({ event_name: 'Purchase' } as any);

    const res = await buildApp().get('/api/taxonomy/platform-mapping/node-001/meta');

    expect(res.status).toBe(200);
    expect(res.body.mapping.event_name).toBe('Purchase');
  });

  it('returns 404 when mapping does not exist', async () => {
    vi.mocked(taxonomyQueries.fetchPlatformMapping).mockResolvedValue(null);

    const res = await buildApp().get('/api/taxonomy/platform-mapping/node-001/tiktok');

    expect(res.status).toBe(404);
  });
});

// ── POST /api/taxonomy/event ──────────────────────────────────────────────────

describe('POST /api/taxonomy/event', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates custom event and returns 201', async () => {
    vi.mocked(namingConvention.validateEventName).mockReturnValue({ valid: true, errors: [], suggestions: [] });
    vi.mocked(taxonomyQueries.createCustomTaxonomyEvent).mockResolvedValue(MOCK_NODE as any);

    const res = await buildApp().post('/api/taxonomy/event').send(CREATE_EVENT_BODY);

    expect(res.status).toBe(201);
    expect(res.body.node.slug).toBe('purchase');
  });

  it('returns 422 when slug fails naming convention', async () => {
    vi.mocked(namingConvention.validateEventName).mockReturnValue({
      valid: false,
      errors: ['Must be snake_case'],
      suggestions: ['purchase'],
    });

    const res = await buildApp().post('/api/taxonomy/event').send(CREATE_EVENT_BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('naming convention');
  });

  it('returns 409 when event path already exists', async () => {
    vi.mocked(namingConvention.validateEventName).mockReturnValue({ valid: true, errors: [], suggestions: [] });
    vi.mocked(taxonomyQueries.createCustomTaxonomyEvent).mockRejectedValue(
      new Error('duplicate key value violates unique constraint'),
    );

    const res = await buildApp().post('/api/taxonomy/event').send(CREATE_EVENT_BODY);

    expect(res.status).toBe(409);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await buildApp().post('/api/taxonomy/event').send({ slug: 'purchase' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/taxonomy/:id ─────────────────────────────────────────────────────

describe('GET /api/taxonomy/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns taxonomy node by id', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(MOCK_NODE as any);

    const res = await buildApp().get('/api/taxonomy/node-001');

    expect(res.status).toBe(200);
    expect(res.body.node.slug).toBe('purchase');
  });

  it('returns 404 when node does not exist', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(null);

    const res = await buildApp().get('/api/taxonomy/missing');

    expect(res.status).toBe(404);
  });
});

// ── PUT /api/taxonomy/:id ─────────────────────────────────────────────────────

describe('PUT /api/taxonomy/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates custom node', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(MOCK_NODE as any);
    vi.mocked(taxonomyQueries.updateTaxonomyNode).mockResolvedValue({ ...MOCK_NODE, name: 'Updated' } as any);

    const res = await buildApp().put('/api/taxonomy/node-001').send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.node.name).toBe('Updated');
  });

  it('returns 403 for system node', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(SYSTEM_NODE as any);

    const res = await buildApp().put('/api/taxonomy/sys-001').send({ name: 'Hack' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/taxonomy/:id ──────────────────────────────────────────────────

describe('DELETE /api/taxonomy/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deprecates custom node', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(MOCK_NODE as any);
    vi.mocked(taxonomyQueries.countSignalsForTaxonomyEvent).mockResolvedValue(0);
    vi.mocked(taxonomyQueries.deprecateTaxonomyNode).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/taxonomy/node-001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for system node', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(SYSTEM_NODE as any);

    const res = await buildApp().delete('/api/taxonomy/sys-001');

    expect(res.status).toBe(403);
  });

  it('returns 409 when signals are linked (no ?force=true)', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(MOCK_NODE as any);
    vi.mocked(taxonomyQueries.countSignalsForTaxonomyEvent).mockResolvedValue(3);

    const res = await buildApp().delete('/api/taxonomy/node-001');

    expect(res.status).toBe(409);
    expect(res.body.signal_count).toBe(3);
  });

  it('allows deletion with ?force=true when signals linked', async () => {
    vi.mocked(taxonomyQueries.fetchTaxonomyNode).mockResolvedValue(MOCK_NODE as any);
    vi.mocked(taxonomyQueries.countSignalsForTaxonomyEvent).mockResolvedValue(3);
    vi.mocked(taxonomyQueries.deprecateTaxonomyNode).mockResolvedValue(undefined);

    const res = await buildApp().delete('/api/taxonomy/node-001?force=true');

    expect(res.status).toBe(200);
  });
});
