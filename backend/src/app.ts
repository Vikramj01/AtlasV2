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
import { consentRouter } from '@/api/routes/consent';
import { capiRouter } from '@/api/routes/capi';
import { checklistRouter } from '@/api/routes/checklist';
import { healthRouter } from '@/api/routes/health';
import { readinessRouter } from '@/api/routes/readiness';
import { schedulesRouter } from '@/api/routes/schedules';
import { adminRouter } from '@/api/routes/admin';
import { authRouter } from '@/api/routes/auth';
import { channelsRouter } from '@/api/routes/channels';
import { dashboardRouter } from '@/api/routes/dashboard';
import { exportsRouter } from '@/api/routes/exports';
import { offlineConversionsRouter } from '@/api/routes/offlineConversions';
import { billingRouter } from '@/api/routes/billing';
import { taxonomyRouter } from '@/api/routes/taxonomy';
import { namingConventionsRouter } from '@/api/routes/namingConventions';
import { strategyRouter } from '@/api/routes/strategy';
import logger from '@/utils/logger';
import { env } from '@/config/env';

const app = express();

// Trust Render's reverse proxy so express-rate-limit can read the real client
// IP from X-Forwarded-For without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ─── Security & parsing middleware ────────────────────────────────────────────

// Stripe webhook requires the raw request body for signature verification.
// Register express.raw() for this exact path BEFORE express.json() so the
// global JSON parser does not consume the body first.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(helmet());
app.use(cors({
  origin: (incoming, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!incoming) return callback(null, true);

    const allowed = env.ALLOWED_ORIGINS.some((pattern) => {
      if (pattern === incoming) return true;
      // Wildcard support: * in a pattern matches any characters.
      // Example pattern: https://*-vikramj01s-projects.vercel.app
      if (pattern.includes('*')) {
        const regex = new RegExp(
          '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
        );
        return regex.test(incoming);
      }
      return false;
    });

    if (allowed) return callback(null, true);
    callback(new Error(`CORS: origin not allowed: ${incoming}`));
  },
  credentials: true,
}));
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
app.use('/api/strategy/evaluate', heavyLimiter);
app.use('/api/strategy/objectives/:id/evaluate', heavyLimiter);
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
app.use('/api/consent', consentRouter);
app.use('/api/capi', capiRouter);
app.use('/api/setup-checklist', checklistRouter);
app.use('/api/health', healthRouter);
app.use('/api/readiness-score', readinessRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/offline-conversions', offlineConversionsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/taxonomy', taxonomyRouter);
app.use('/api/naming-convention', namingConventionsRouter);
app.use('/api/strategy', strategyRouter);

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
