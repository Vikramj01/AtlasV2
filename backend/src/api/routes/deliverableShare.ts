/**
 * Public deliverable share route — /api/share
 * No auth required. Token-based read access to shareable_deliverable_links.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { fetchPublicShare } from '@/services/tracking/shareableLinkService';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';

const router = Router();

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 32) {
      return res.status(404).json({ data: null, error: 'Invalid token', message: null });
    }

    const result = await fetchPublicShare(token);
    if (!result) {
      return res.status(404).json({ data: null, error: 'Link not found or has expired', message: null });
    }

    res.json({ data: result, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Fetch public share failed');
    sendInternalError(res, err);
  }
});

export { router as deliverableShareRouter };
