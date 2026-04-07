/**
 * UploadArea — Drag-and-drop CSV upload zone
 *
 * Handles file selection and POSTs the file to the backend for validation.
 * Shows loading state during upload. On success, the parent receives the
 * validation response and transitions to ValidationReview.
 *
 * Constraints (enforced here AND on the backend):
 *   - CSV files only
 *   - Max 10 MB
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { offlineConversionsApi } from '@/lib/api/offlineConversionsApi';
import { useOfflineConversionsStore } from '@/store/offlineConversionsStore';
import type { UploadValidationResponse } from '@/types/offline-conversions';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

interface Props {
  onValidated: (response: UploadValidationResponse) => void;
}

export function UploadArea({ onValidated }: Props) {
  const {
    uploadLoading, uploadError,
    setUploadLoading, setUploadError,
  } = useOfflineConversionsStore();

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File validation ────────────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    if (file.size === 0) return 'The file is empty.';
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File exceeds 10 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB). Split data into smaller files.`;
    }
    const isCSV =
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel' ||
      file.name.toLowerCase().endsWith('.csv');
    if (!isCSV) return 'Please upload a CSV file.';
    return null;
  }

  // ── Upload handler ─────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadLoading(true);
    setUploadError(null);

    try {
      const response = await offlineConversionsApi.uploadCsv(file);
      onValidated(response);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploadLoading(false);
    }
  }

  // ── Drag events ────────────────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only fire if leaving the zone entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so the same file can be re-selected after an error
    e.target.value = '';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (uploadLoading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted py-16 gap-3">
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Uploading and validating…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        aria-label="Click or drag a CSV file here to upload"
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-14 gap-3 transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isDraggingOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
        ].join(' ')}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl">
          📂
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">
            {isDraggingOver ? 'Drop your CSV here' : 'Drag & drop your CSV, or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground">CSV files only · Max 10 MB · ~50,000 rows</p>
        </div>
        <Button variant="outline" size="sm" tabIndex={-1}>
          Browse file
        </Button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv,application/vnd.ms-excel"
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Error banner */}
      {uploadError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}
