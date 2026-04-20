import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '@/services/database/supabase';

/**
 * strategyGate — rejects the request if no strategy brief exists for this user's org.
 * Applied to POST /api/planning/sessions, POST /api/journeys, POST /api/signal-packs/deploy.
 */
export async function strategyGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('strategy_briefs')
    .select('id')
    .eq('organization_id', userId)
    .limit(1);

  if (error || !data || data.length === 0) {
    res.status(400).json({ error: 'Lock your conversion event first.' });
    return;
  }

  next();
}
