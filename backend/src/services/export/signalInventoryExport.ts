/**
 * Signal Inventory Export — generates a three-worksheet XLSX workbook.
 *
 * Sheet 1 – Signal Inventory   : all signals for the org with status & platform coverage
 * Sheet 2 – Implementation Checklist : per-page tracking tasks from the latest planning session
 * Sheet 3 – Platform Mapping   : GA4 / Google Ads / Meta / TikTok / LinkedIn event taxonomy
 *
 * Conditional formatting (Sheet 1 status column):
 *   Verified      → green  (#D1FAE5 / #065F46)
 *   Implemented   → blue   (#DBEAFE / #1E40AF)
 *   Pending       → amber  (#FEF3C7 / #92400E)
 *   Not Started   → red    (#FEE2E2 / #991B1B)
 */

import ExcelJS from 'exceljs';
import { supabaseAdmin as supabase } from '@/services/database/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Signal {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  is_system: boolean;
  required_params: Array<{ key: string; label: string }>;
  optional_params: Array<{ key: string; label: string }>;
  platform_mappings: Record<string, { event_name: string; param_mapping: Record<string, string> }>;
  updated_at: string;
}

interface PlanningPage {
  id: string;
  url: string;
  page_title: string | null;
}

interface Recommendation {
  id: string;
  page_id: string;
  event_name: string;
  required_params: Array<{ param_key: string; param_label: string }>;
  optional_params: Array<{ param_key: string; param_label: string }>;
  user_decision: string | null;
  business_justification: string;
  affected_platforms: string[];
}

interface ImplProgress {
  page_id: string;
  status: string;
  developer_notes: string | null;
}

type SignalStatus = 'Verified' | 'Implemented' | 'Pending' | 'Not Started';

const STATUS_FILL: Record<SignalStatus, { bgColor: string; fontColor: string }> = {
  Verified:    { bgColor: 'D1FAE5', fontColor: '065F46' },
  Implemented: { bgColor: 'DBEAFE', fontColor: '1E40AF' },
  Pending:     { bgColor: 'FEF3C7', fontColor: '92400E' },
  'Not Started': { bgColor: 'FEE2E2', fontColor: '991B1B' },
};

const PLATFORM_KEYS = ['ga4', 'google_ads', 'meta', 'tiktok', 'linkedin'] as const;
const PLATFORM_LABELS: Record<string, string> = {
  ga4:        'GA4',
  google_ads: 'Google Ads',
  meta:       'Meta',
  tiktok:     'TikTok',
  linkedin:   'LinkedIn',
};

// ── Shared style helpers ──────────────────────────────────────────────────────

function headerFill(): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
}

function headerFont(): Partial<ExcelJS.Font> {
  return { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = headerFill();
    cell.font = headerFont();
    cell.alignment = { vertical: 'middle', wrapText: false };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });
  row.height = 24;
}

function applyStatusFill(cell: ExcelJS.Cell, status: SignalStatus) {
  const { bgColor, fontColor } = STATUS_FILL[status];
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };
  cell.font = { bold: true, color: { argb: `FF${fontColor}` }, size: 10 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

function zebra(row: ExcelJS.Row, idx: number) {
  if (idx % 2 === 0) {
    row.eachCell((cell) => {
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb === 'FFFFFFFF') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  }
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchSignals(orgId?: string): Promise<Signal[]> {
  let query = supabase.from('signals').select('*');
  if (orgId) {
    query = supabase
      .from('signals')
      .select('*')
      .or(`is_system.eq.true,organisation_id.eq.${orgId}`);
  } else {
    query = query.eq('is_system', true);
  }
  const { data, error } = await query.order('category').order('name');
  if (error) throw new Error(`Failed to fetch signals: ${error.message}`);
  return (data ?? []) as Signal[];
}

async function fetchLatestSession(
  userId: string,
): Promise<{ id: string; website_url: string } | null> {
  const { data } = await supabase
    .from('planning_sessions')
    .select('id, website_url')
    .eq('user_id', userId)
    .eq('status', 'outputs_ready')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; website_url: string } | null;
}

async function fetchPages(sessionId: string): Promise<PlanningPage[]> {
  const { data, error } = await supabase
    .from('planning_pages')
    .select('id, url, page_title')
    .eq('session_id', sessionId)
    .order('page_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch pages: ${error.message}`);
  return (data ?? []) as PlanningPage[];
}

async function fetchRecommendations(pageIds: string[]): Promise<Recommendation[]> {
  if (pageIds.length === 0) return [];
  const { data, error } = await supabase
    .from('planning_recommendations')
    .select('id, page_id, event_name, required_params, optional_params, user_decision, business_justification, affected_platforms')
    .in('page_id', pageIds)
    .order('page_id');
  if (error) throw new Error(`Failed to fetch recommendations: ${error.message}`);
  return (data ?? []) as Recommendation[];
}

async function fetchImplProgress(
  userId: string,
  pageIds: string[],
): Promise<ImplProgress[]> {
  if (pageIds.length === 0) return [];
  // Get latest active share for this user
  const { data: shares } = await supabase
    .from('developer_shares')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!shares || shares.length === 0) return [];
  const shareId = (shares[0] as { id: string }).id;

  const { data, error } = await supabase
    .from('implementation_progress')
    .select('page_id, status, developer_notes')
    .eq('share_id', shareId)
    .in('page_id', pageIds);

  if (error) return [];
  return (data ?? []) as ImplProgress[];
}

// ── Derive signal status from recommendations ─────────────────────────────────

function deriveSignalStatus(
  signal: Signal,
  recommendations: Recommendation[],
  implProgressByPageId: Map<string, string>,
): SignalStatus {
  const matchingRecs = recommendations.filter(
    (r) => r.event_name === signal.key ||
           r.event_name.toLowerCase() === signal.name.toLowerCase(),
  );

  if (matchingRecs.length === 0) return 'Not Started';

  const hasApproved = matchingRecs.some((r) => r.user_decision === 'approved');
  const hasImpl = matchingRecs.some((r) => {
    const ps = implProgressByPageId.get(r.page_id);
    return ps === 'implemented' || ps === 'verified';
  });

  if (hasImpl) return hasApproved ? 'Verified' : 'Implemented';
  if (hasApproved) return 'Pending';
  return 'Pending';
}

// ── Sheet 1: Signal Inventory ─────────────────────────────────────────────────

function buildSheet1(
  wb: ExcelJS.Workbook,
  signals: Signal[],
  recommendations: Recommendation[],
  implProgressByPageId: Map<string, string>,
  pageById: Map<string, PlanningPage>,
) {
  const ws = wb.addWorksheet('Signal Inventory');

  // Column widths
  ws.columns = [
    { key: 'name',       width: 28 },
    { key: 'category',   width: 16 },
    { key: 'description',width: 44 },
    { key: 'platforms',  width: 32 },
    { key: 'priority',   width: 12 },
    { key: 'status',     width: 16 },
    { key: 'verified',   width: 18 },
    { key: 'pages',      width: 44 },
  ];

  const headers = ['Signal Name', 'Category', 'Description', 'Platforms', 'Priority', 'Status', 'Last Verified', 'Pages'];
  const headerRow = ws.addRow(headers);
  styleHeader(headerRow);
  ws.autoFilter = { from: 'A1', to: 'H1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  signals.forEach((signal, idx) => {
    const platforms = PLATFORM_KEYS
      .filter((k) => signal.platform_mappings?.[k])
      .map((k) => PLATFORM_LABELS[k])
      .join(', ');

    const status = deriveSignalStatus(signal, recommendations, implProgressByPageId);

    const matchingRecs = recommendations.filter(
      (r) => r.event_name === signal.key ||
             r.event_name.toLowerCase() === signal.name.toLowerCase(),
    );
    const pages = [...new Set(
      matchingRecs
        .map((r) => pageById.get(r.page_id)?.url ?? '')
        .filter(Boolean)
    )].join(', ');

    const priority = signal.is_system ? 'Core' : 'Custom';
    const lastVerified = new Date(signal.updated_at).toLocaleDateString('en-GB');

    const row = ws.addRow([signal.name, signal.category, signal.description, platforms, priority, status, lastVerified, pages]);

    // Status cell conditional formatting
    const statusCell = row.getCell(6);
    applyStatusFill(statusCell, status);

    // Wrap description & pages
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(8).alignment = { wrapText: true, vertical: 'top' };
    row.height = 36;

    zebra(row, idx);
  });
}

// ── Sheet 2: Implementation Checklist ─────────────────────────────────────────

function buildSheet2(
  wb: ExcelJS.Workbook,
  pages: PlanningPage[],
  recommendations: Recommendation[],
  implProgressByPageId: Map<string, string>,
  implNotesByPageId: Map<string, string>,
) {
  const ws = wb.addWorksheet('Implementation Checklist');

  ws.columns = [
    { key: 'page',        width: 36 },
    { key: 'signal',      width: 28 },
    { key: 'event',       width: 24 },
    { key: 'datalayer',   width: 32 },
    { key: 'status',      width: 16 },
    { key: 'notes',       width: 44 },
  ];

  const headers = ['Page URL', 'Signal Name', 'Expected Event', 'dataLayer Keys', 'Status', 'Developer Notes'];
  const headerRow = ws.addRow(headers);
  styleHeader(headerRow);
  ws.autoFilter = { from: 'A1', to: 'F1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const recsByPage = new Map<string, Recommendation[]>();
  for (const rec of recommendations) {
    const arr = recsByPage.get(rec.page_id) ?? [];
    arr.push(rec);
    recsByPage.set(rec.page_id, arr);
  }

  let globalIdx = 0;
  for (const page of pages) {
    const recs = recsByPage.get(page.id) ?? [];
    if (recs.length === 0) continue;

    // Page group header
    const groupRow = ws.addRow([page.url, '', '', '', '', '']);
    groupRow.getCell(1).font = { bold: true, color: { argb: 'FF475569' }, size: 10 };
    groupRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.mergeCells(`A${groupRow.number}:F${groupRow.number}`);
    groupRow.height = 20;

    for (const rec of recs) {
      const implStatus = implProgressByPageId.get(rec.page_id) ?? 'not_started';
      const implNotes = implNotesByPageId.get(rec.page_id) ?? '';

      const datalayerKeys = [
        ...rec.required_params.map((p) => `${p.param_key}*`),
        ...rec.optional_params.map((p) => p.param_key),
      ].join(', ');

      const displayStatus = implStatus
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const row = ws.addRow([
        page.url,
        rec.event_name,
        rec.event_name,
        datalayerKeys,
        displayStatus,
        implNotes,
      ]);

      // Status fill
      const statusCell = row.getCell(5);
      if (implStatus === 'implemented' || implStatus === 'verified') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        statusCell.font = { color: { argb: 'FF065F46' }, bold: true, size: 10 };
      } else if (implStatus === 'in_progress') {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        statusCell.font = { color: { argb: 'FF92400E' }, bold: true, size: 10 };
      } else {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        statusCell.font = { color: { argb: 'FF991B1B' }, bold: true, size: 10 };
      }
      statusCell.alignment = { horizontal: 'center', vertical: 'middle' };

      row.getCell(4).font = { name: 'Courier New', size: 9 };
      row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
      row.height = 28;
      zebra(row, globalIdx);
      globalIdx++;
    }
  }
}

// ── Sheet 3: Platform Mapping ─────────────────────────────────────────────────

function buildSheet3(wb: ExcelJS.Workbook, signals: Signal[]) {
  const ws = wb.addWorksheet('Platform Mapping');

  ws.columns = [
    { key: 'signal',      width: 28 },
    { key: 'category',    width: 14 },
    { key: 'ga4',         width: 24 },
    { key: 'google_ads',  width: 24 },
    { key: 'meta',        width: 24 },
    { key: 'tiktok',      width: 24 },
    { key: 'linkedin',    width: 24 },
  ];

  const headers = ['Signal Name', 'Category', 'GA4 Event', 'Google Ads Event', 'Meta Event', 'TikTok Event', 'LinkedIn Event'];
  const headerRow = ws.addRow(headers);
  styleHeader(headerRow);
  ws.autoFilter = { from: 'A1', to: 'G1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  signals.forEach((signal, idx) => {
    const row = ws.addRow([
      signal.name,
      signal.category,
      signal.platform_mappings?.['ga4']?.event_name ?? '—',
      signal.platform_mappings?.['google_ads']?.event_name ?? '—',
      signal.platform_mappings?.['meta']?.event_name ?? '—',
      signal.platform_mappings?.['tiktok']?.event_name ?? '—',
      signal.platform_mappings?.['linkedin']?.event_name ?? '—',
    ]);

    // Grey out unmapped cells
    for (let col = 3; col <= 7; col++) {
      const cell = row.getCell(col);
      if (cell.value === '—') {
        cell.font = { color: { argb: 'FF94A3B8' }, size: 10 };
      } else {
        cell.font = { name: 'Courier New', size: 9 };
      }
    }

    row.height = 22;
    zebra(row, idx);
  });
}

// ── Main export function ──────────────────────────────────────────────────────

export async function generateSignalInventoryExport(
  userId: string,
  orgId?: string,
): Promise<Buffer> {
  // Fetch all data in parallel where possible
  const [signals, latestSession] = await Promise.all([
    fetchSignals(orgId),
    fetchLatestSession(userId),
  ]);

  let pages: PlanningPage[] = [];
  let recommendations: Recommendation[] = [];
  let implProgress: ImplProgress[] = [];

  if (latestSession) {
    pages = await fetchPages(latestSession.id);
    const pageIds = pages.map((p) => p.id);
    [recommendations, implProgress] = await Promise.all([
      fetchRecommendations(pageIds),
      fetchImplProgress(userId, pageIds),
    ]);
  }

  // Build lookup maps
  const implProgressByPageId = new Map<string, string>(
    implProgress.map((p) => [p.page_id, p.status]),
  );
  const implNotesByPageId = new Map<string, string>(
    implProgress.filter((p) => p.developer_notes).map((p) => [p.page_id, p.developer_notes!]),
  );
  const pageById = new Map<string, PlanningPage>(pages.map((p) => [p.id, p]));

  // Build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Atlas';
  wb.created = new Date();
  wb.properties.date1904 = false;

  buildSheet1(wb, signals, recommendations, implProgressByPageId, pageById);
  buildSheet2(wb, pages, recommendations, implProgressByPageId, implNotesByPageId);
  buildSheet3(wb, signals);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
