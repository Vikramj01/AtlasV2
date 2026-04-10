import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import logger from '@/utils/logger';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    logger.warn({ error: error?.message }, 'Auth failed — invalid token');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Fetch the user's plan from profiles table
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();

  const email = user.email ?? '';
  req.user = {
    id: user.id,
    email,
    plan: (profile?.plan as 'free' | 'pro' | 'agency') ?? 'free',
    isSuperAdmin: env.SUPER_ADMIN_EMAILS.includes(email.toLowerCase()),
  };

  next();
}
