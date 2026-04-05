/**
 * Exports API — /api/exports
 *
 * GET /api/exports/signal-inventory?org_id=xxx
 *   Streams a three-worksheet XLSX workbook:
 *     Sheet 1 – Signal Inventory
 *     Sheet 2 – Implementation Checklist
 *     Sheet 3 – Platform Mapping
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { generateSignalInventoryExport } from '@/services/export/signalInventoryExport';
import logger from '@/utils/logger';

export const exportsRouter = Router();
exportsRouter.use(authMiddleware);

// ── GET /api/exports/signal-inventory ────────────────────────────────────────

exportsRouter.get(
  '/signal-inventory',
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user.id;
    const orgId = typeof req.query['org_id'] === 'string' ? req.query['org_id'] : undefined;

    try {
      logger.info({ userId, orgId }, 'Generating signal inventory export');
      const buffer = await generateSignalInventoryExport(userId, orgId);

      const filename = `atlas-signal-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      sendInternalError(res, err, 'signal-inventory-export');
    }
  },
);
