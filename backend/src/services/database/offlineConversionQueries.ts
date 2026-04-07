/**
 * Offline Conversion Upload — Database CRUD layer.
 *
 * All DB access for offline conversions goes through these functions.
 * Uses supabaseAdmin (service-role key) to bypass RLS — caller is
 * responsible for ensuring organization_id scoping on all queries.
 *
 * Tables: offline_conversion_configs, offline_conversion_uploads, offline_conversion_rows
 */

import { supabaseAdmin as supabase } from './supabase';
import type {
  OfflineConversionConfig,
  OfflineConversionUpload,
  OfflineConversionRow,
  OfflineUploadStatus,
  OfflineRowStatus,
  UpsertConfigInput,
  CreateUploadInput,
  InsertRowInput,
  ValidationSummary,
  ValidationIssue,
  GoogleRowResult,
  UploadResult,
} from '@/types/offline-conversions';

// ── Config ────────────────────────────────────────────────────────────────────

export async function upsertConfig(input: UpsertConfigInput): Promise<OfflineConversionConfig> {
  const { data, error } = await supabase
    .from('offline_conversion_configs')
    .upsert(
      {
        organization_id: input.organization_id,
        google_customer_id: input.google_customer_id,
        conversion_action_id: input.conversion_action_id,
        conversion_action_name: input.conversion_action_name,
        column_mapping: input.column_mapping,
        default_currency: input.default_currency,
        default_conversion_value: input.default_conversion_value ?? null,
        capi_provider_id: input.capi_provider_id,
        status: 'active',
        error_message: null,
      },
      { onConflict: 'organization_id' },
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to upsert offline conversion config: ${error.message}`);
  return data as OfflineConversionConfig;
}

export async function getConfig(organizationId: string): Promise<OfflineConversionConfig | null> {
  const { data, error } = await supabase
    .from('offline_conversion_configs')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get offline conversion config: ${error.message}`);
  return data as OfflineConversionConfig | null;
}

export async function setConfigError(organizationId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from('offline_conversion_configs')
    .update({ status: 'error', error_message: message })
    .eq('organization_id', organizationId);

  if (error) throw new Error(`Failed to set config error: ${error.message}`);
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export async function createUpload(input: CreateUploadInput): Promise<OfflineConversionUpload> {
  const { data, error } = await supabase
    .from('offline_conversion_uploads')
    .insert({
      organization_id: input.organization_id,
      config_id: input.config_id,
      filename: input.filename,
      file_size_bytes: input.file_size_bytes,
      uploaded_by: input.uploaded_by,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create upload record: ${error.message}`);
  return data as OfflineConversionUpload;
}

export async function getUpload(
  uploadId: string,
  organizationId: string,
): Promise<OfflineConversionUpload | null> {
  const { data, error } = await supabase
    .from('offline_conversion_uploads')
    .select('*')
    .eq('id', uploadId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get upload: ${error.message}`);
  return data as OfflineConversionUpload | null;
}

export async function setUploadValidated(
  uploadId: string,
  summary: ValidationSummary,
  rowCountValid: number,
  rowCountInvalid: number,
  rowCountDuplicate: number,
  totalRows: number,
): Promise<void> {
  const { error } = await supabase
    .from('offline_conversion_uploads')
    .update({
      status: 'validated',
      validated_at: new Date().toISOString(),
      validation_summary: summary,
      row_count_total: totalRows,
      row_count_valid: rowCountValid,
      row_count_invalid: rowCountInvalid,
      row_count_duplicate: rowCountDuplicate,
    })
    .eq('id', uploadId);

  if (error) throw new Error(`Failed to mark upload as validated: ${error.message}`);
}

export async function setUploadStatus(
  uploadId: string,
  status: OfflineUploadStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase
    .from('offline_conversion_uploads')
    .update({ status, ...extra })
    .eq('id', uploadId);

  if (error) throw new Error(`Failed to set upload status to ${status}: ${error.message}`);
}

export async function setUploadCompleted(
  uploadId: string,
  result: UploadResult,
  rowCountUploaded: number,
  rowCountRejected: number,
): Promise<void> {
  const finalStatus: OfflineUploadStatus =
    rowCountRejected > 0 && rowCountUploaded === 0
      ? 'failed'
      : rowCountRejected > 0
        ? 'partial'
        : 'completed';

  const { error } = await supabase
    .from('offline_conversion_uploads')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      upload_result: result,
      row_count_uploaded: rowCountUploaded,
      row_count_rejected: rowCountRejected,
    })
    .eq('id', uploadId);

  if (error) throw new Error(`Failed to mark upload as completed: ${error.message}`);
}

export async function listUploads(
  organizationId: string,
  page: number,
  pageSize: number,
): Promise<{ uploads: OfflineConversionUpload[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('offline_conversion_uploads')
    .select('*', { count: 'exact' })
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw new Error(`Failed to list uploads: ${error.message}`);
  return {
    uploads: (data ?? []) as OfflineConversionUpload[],
    total: count ?? 0,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Insert all rows for an upload in a single batched call. */
export async function insertRows(rows: InsertRowInput[]): Promise<void> {
  if (rows.length === 0) return;

  // Supabase handles large inserts; chunk at 500 to stay well under limits
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('offline_conversion_rows').insert(chunk);
    if (error) throw new Error(`Failed to insert conversion rows: ${error.message}`);
  }
}

export async function getRowsForUpload(
  uploadId: string,
  statusFilter?: OfflineRowStatus[],
): Promise<OfflineConversionRow[]> {
  let query = supabase
    .from('offline_conversion_rows')
    .select('*')
    .eq('upload_id', uploadId)
    .order('row_index', { ascending: true });

  if (statusFilter && statusFilter.length > 0) {
    query = query.in('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get rows for upload: ${error.message}`);
  return (data ?? []) as OfflineConversionRow[];
}

/** Update the status of a single row after Google upload attempt. */
export async function updateRowUploadResult(
  rowId: string,
  result: GoogleRowResult & { uploaded_at?: string },
): Promise<void> {
  const { error } = await supabase
    .from('offline_conversion_rows')
    .update({
      status: result.status,
      google_error_code: result.error_code,
      google_error_message: result.error_message,
      uploaded_at: result.status === 'uploaded' ? (result.uploaded_at ?? new Date().toISOString()) : null,
    })
    .eq('id', rowId);

  if (error) throw new Error(`Failed to update row upload result: ${error.message}`);
}

/** Batch-update row statuses from Google API results (keyed by row_index). */
export async function bulkUpdateRowStatuses(
  uploadId: string,
  results: GoogleRowResult[],
): Promise<void> {
  if (results.length === 0) return;

  const now = new Date().toISOString();

  // Group by status to minimise round-trips
  const uploaded = results.filter((r) => r.status === 'uploaded').map((r) => r.row_index);
  const rejected = results.filter((r) => r.status === 'rejected');

  if (uploaded.length > 0) {
    const { error } = await supabase
      .from('offline_conversion_rows')
      .update({ status: 'uploaded', uploaded_at: now })
      .eq('upload_id', uploadId)
      .in('row_index', uploaded);
    if (error) throw new Error(`Failed to bulk update uploaded rows: ${error.message}`);
  }

  // Rejected rows need per-row error details — update individually
  for (const r of rejected) {
    const { error } = await supabase
      .from('offline_conversion_rows')
      .update({
        status: 'rejected',
        google_error_code: r.error_code,
        google_error_message: r.error_message,
      })
      .eq('upload_id', uploadId)
      .eq('row_index', r.row_index);
    if (error) throw new Error(`Failed to update rejected row ${r.row_index}: ${error.message}`);
  }
}

/** Call purge_raw_pii() DB function after upload completes. */
export async function purgeRawPii(uploadId: string): Promise<number> {
  const { data, error } = await supabase.rpc('purge_raw_pii', { p_upload_id: uploadId });
  if (error) throw new Error(`Failed to purge raw PII for upload ${uploadId}: ${error.message}`);
  return data as number;
}

/** Check for duplicate order_ids or hashed_emails across previous uploads for this org. */
export async function findCrossUploadDuplicates(
  organizationId: string,
  orderIds: string[],
  hashedEmails: string[],
  excludeUploadId: string,
): Promise<{ orderIds: Set<string>; hashedEmails: Set<string> }> {
  const result = { orderIds: new Set<string>(), hashedEmails: new Set<string>() };

  if (orderIds.length > 0) {
    const { data } = await supabase
      .from('offline_conversion_rows')
      .select('order_id')
      .eq('organization_id', organizationId)
      .neq('upload_id', excludeUploadId)
      .in('order_id', orderIds)
      .in('status', ['uploaded', 'valid', 'duplicate']);

    for (const row of data ?? []) {
      if (row.order_id) result.orderIds.add(row.order_id);
    }
  }

  if (hashedEmails.length > 0) {
    const { data } = await supabase
      .from('offline_conversion_rows')
      .select('hashed_email, conversion_time')
      .eq('organization_id', organizationId)
      .neq('upload_id', excludeUploadId)
      .in('hashed_email', hashedEmails)
      .in('status', ['uploaded', 'valid']);

    for (const row of data ?? []) {
      if (row.hashed_email) result.hashedEmails.add(row.hashed_email);
    }
  }

  return result;
}

/** Fetch a page of rows for the detail view (e.g. error log). */
export async function getUploadRowPage(
  uploadId: string,
  page: number,
  pageSize: number,
  statusFilter?: OfflineRowStatus[],
): Promise<{ rows: OfflineConversionRow[]; total: number }> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('offline_conversion_rows')
    .select('*', { count: 'exact' })
    .eq('upload_id', uploadId)
    .order('row_index', { ascending: true })
    .range(from, to);

  if (statusFilter && statusFilter.length > 0) {
    query = query.in('status', statusFilter);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to get upload rows page: ${error.message}`);

  return { rows: (data ?? []) as OfflineConversionRow[], total: count ?? 0 };
}
