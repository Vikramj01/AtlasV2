import { supabaseAdmin } from '@/services/database/supabase';

export interface AirMetricRow {
  org_id: string;
  source: 'google_ads' | 'meta_ads' | 'ga4';
  metric_name: string;
  dimension: string | null;
  value: number;
  snapshot_date: string; // YYYY-MM-DD
}

export function yesterday(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

// Upserts rows into air_metric_snapshots. The UNIQUE constraint on
// (org_id, source, metric_name, dimension, snapshot_date) makes this idempotent.
export async function writeMetricRows(rows: AirMetricRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await (supabaseAdmin
    .from('air_metric_snapshots') as unknown as {
      upsert: (
        rows: AirMetricRow[],
        opts: { onConflict: string; ignoreDuplicates: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    })
    .upsert(rows, { onConflict: 'org_id,source,metric_name,dimension,snapshot_date', ignoreDuplicates: true });

  if (error) throw new Error(`air_metric_snapshots upsert failed: ${error.message}`);
}
