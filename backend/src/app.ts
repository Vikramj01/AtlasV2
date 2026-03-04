import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import auditRoutes from '@/api/routes/audits';
import { journeysRouter } from '@/api/routes/journeys';
import logger from '@/utils/logger';

const app = express();

// ─── Security & parsing middleware ────────────────────────────────────────────

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));

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
app.use('/api/templates', journeysRouter);
app.use('/api/action-primitives', journeysRouter);

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
