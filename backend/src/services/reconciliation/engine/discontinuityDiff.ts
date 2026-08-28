import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation, getSeverity, getDimension } from '../codes/findingCodes';
import logger from '@/utils/logger';

interface PlatformDiscontinuity {
  id: string;
  platform: string;
  title: string;
  effective_date: string | null;
  description: string;
}

interface Connection {
  id: string;
  platform: string;
}

// A discontinuity is surfaced for this long after its effective date — long
// enough to cover the drift it causes, short enough that it stops repeating
// on every future run once the platform's numbers have re-stabilised.
// Discontinuities with no confirmed effective_date are always surfaced,
// since there is no window to age them out of.
const ANNOTATION_WINDOW_DAYS = 120;

function isWithinAnnotationWindow(effectiveDate: string | null): boolean {
  if (!effectiveDate) return true;
  const effective = new Date(effectiveDate).getTime();
  const windowEnd = effective + ANNOTATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() <= windowEnd;
}

/**
 * Surfaces known platform-side reporting redefinitions (e.g. Meta's 3 Mar
 * 2026 click-through attribution change) as informational findings *before*
 * the volume/alignment diffs run, so a discontinuity-shaped drift reads as
 * an annotated, explained change rather than an unexplained anomaly.
 */
export async function runDiscontinuityDiff(
  runId: string,
  clientId: string,
  orgId: string,
): Promise<void> {
  const { data: connections } = await supabaseAdmin
    .from('platform_connections')
    .select('id, platform')
    .eq('client_id', clientId)
    .eq('status', 'active') as unknown as { data: Connection[] | null };

  if (!connections?.length) return;

  const activePlatforms = [...new Set(connections.map((c) => c.platform))];

  const { data: discontinuities, error } = await supabaseAdmin
    .from('platform_discontinuities')
    .select('id, platform, title, effective_date, description')
    .in('platform', activePlatforms) as unknown as { data: PlatformDiscontinuity[] | null; error: unknown };

  if (error || !discontinuities?.length) return;

  for (const d of discontinuities) {
    if (!isWithinAnnotationWindow(d.effective_date)) continue;

    await writeFinding({
      runId,
      organizationId: orgId,
      clientId,
      platform: d.platform,
      dimension: getDimension('KNOWN_PLATFORM_DISCONTINUITY'),
      severity: getSeverity('KNOWN_PLATFORM_DISCONTINUITY'),
      findingCode: 'KNOWN_PLATFORM_DISCONTINUITY',
      expected: null,
      observed: { discontinuity_id: d.id, title: d.title, effective_date: d.effective_date },
      narrative: buildNarrative('KNOWN_PLATFORM_DISCONTINUITY', {
        platform: d.platform,
        title: d.title,
        effective_date: d.effective_date ?? '',
        description: d.description,
      }),
      remediationHint: buildRemediation('KNOWN_PLATFORM_DISCONTINUITY', {}),
    });
  }

  logger.info({ runId, clientId, count: discontinuities.length }, 'Discontinuity diff complete');
}
