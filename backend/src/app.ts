import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import auditRoutes from '@/api/routes/audits';
import { journeysRouter } from '@/api/routes/journeys';
import { planningRouter } from '@/api/routes/planning';
import { shareRouter, devRouter } from '@/api/routes/developer';
import { organisationsRouter } from '@/api/routes/organisations';
import { clientsRouter } from '@/api/routes/clients';
import { signalsRouter } from '@/api/routes/signals';
import logger from '@/utils/logger';
import { env } from '@/config/env';

const app = express();

// Trust Render's reverse proxy so express-rate-limit can read the real client
// IP from X-Forwarded-For without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ─── Security & parsing middleware ────────────────────────────────────────────

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// ─── IP-based rate limiting ───────────────────────────────────────────────────
// Global limit: 200 requests per 15 minutes per IP (covers all /api/* routes).
// Tighter limits are applied per-endpoint below for compute-heavy operations.

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests, please try again later.' },
});

// Tighter limit for spec generation and output generation (CPU-intensive).
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many generation requests, please try again later.' },
});

app.use('/api', globalLimiter);
app.use('/api/journeys/:id/generate', heavyLimiter);
app.use('/api/planning/sessions/:id/generate', heavyLimiter);
app.use('/api/organisations/:orgId/clients/:clientId/generate', heavyLimiter);
app.use('/api/organisations/:orgId/clients/:clientId/generate-all', heavyLimiter);

// ─── Request logging ─────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Incoming request');
  next();
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api/audits', auditRoutes);
app.use('/api/journeys', journeysRouter);
app.use('/api/planning', planningRouter);
// Share management: /api/planning/sessions/:id/share (JWT-protected)
app.use('/api/planning/sessions/:id/share', shareRouter);
// Developer portal: /api/dev/* (public, token-auth)
app.use('/api/dev', devRouter);
// Composable signals & agency workspaces
app.use('/api/organisations', organisationsRouter);
app.use('/api/organisations', clientsRouter);
app.use('/api/signals', signalsRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
