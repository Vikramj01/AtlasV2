/**
 * AudienceUploadTab — Customer Match upload form + history for Google Data Manager.
 * Rendered inside CAPIMonitoringDashboard when provider === 'google' and tab === 'audience'.
 */

import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { capiApi } from '@/lib/api/capiApi';

// ── Types ─────────────────────────────────────────────────────────────────────

type OperationType = 'CREATE' | 'REMOVE';

interface AudienceUpload {
  id: string;
  operation_type: string;
  status: string;
  record_count: number;
  matched_count: number | null;
  failed_count: number | null;
  error_message: string | null;
  created_at: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AudienceUploadTabProps {
  orgId: string; // used to scope upload history display only; actual auth is via Bearer token
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
  processing: 'bg-amber-100 text-amber-700',
  pending:    'bg-gray-100 text-gray-600',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-[#E5E7EB]">
          {[0, 1, 2, 3, 4, 5].map((j) => (
            <td key={j} className="py-3 px-0">
              <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: j === 0 ? '6rem' : '3.5rem' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AudienceUploadTab({ orgId: _orgId }: AudienceUploadTabProps) {
  // Form state
  const [customerId, setCustomerId] = useState('');
  const [operationType, setOperationType] = useState<OperationType>('CREATE');
  const [emailsText, setEmailsText] = useState('');
  const [phonesText, setPhonesText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<AudienceUpload[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await capiApi.getAudienceUploads();
      setHistory(res.data);
    } catch {
      // leave current history in place on error
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    const emails = emailsText.split('\n').map((s: string) => s.trim()).filter(Boolean);
    const phones = phonesText.split('\n').map((s: string) => s.trim()).filter(Boolean);

    const maxLen = Math.max(emails.length, phones.length);
    if (maxLen === 0) {
      setErrorMsg('Please enter at least one email address.');
      return;
    }

    const contacts = Array.from({ length: maxLen }, (_, i) => {
      const contact: { email?: string; phone?: string } = {};
      if (emails[i]) contact.email = emails[i];
      if (phones[i]) contact.phone = phones[i];
      return contact;
    });

    setSubmitting(true);
    try {
      const res = await capiApi.uploadAudience({
        customer_id: customerId,
        contacts,
        operation_type: operationType,
      });
      const { record_count, matched_count, failed_count } = res.data;
      setSuccessMsg(
        `Uploaded ${record_count.toLocaleString()} record${record_count !== 1 ? 's' : ''} — ${(matched_count ?? 0).toLocaleString()} matched, ${(failed_count ?? 0).toLocaleString()} failed.`,
      );
      setEmailsText('');
      setPhonesText('');
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Upload form card ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-5">
        <p className="text-section-header mb-4">Upload Customer Match Audience</p>

        <form onSubmit={(e: FormEvent<HTMLFormElement>) => { void handleSubmit(e); }} className="space-y-4">

          {/* Customer ID */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#374151]" htmlFor="aud-customer-id">
              Google Ads Customer ID
            </label>
            <input
              id="aud-customer-id"
              type="text"
              value={customerId}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCustomerId(e.target.value)}
              placeholder="123-456-7890"
              className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
              required
            />
          </div>

          {/* Operation type toggle */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#374151]">Operation</p>
            <div className="flex items-center rounded-lg border border-[#E5E7EB] p-0.5 w-fit">
              {(['CREATE', 'REMOVE'] as OperationType[]).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => setOperationType(op)}
                  className="px-3 py-1 text-xs font-medium rounded transition-colors"
                  style={
                    operationType === op
                      ? { backgroundColor: '#1B2A4A', color: '#fff' }
                      : { color: '#9CA3AF' }
                  }
                >
                  {op === 'CREATE' ? 'Add to audience' : 'Remove from audience'}
                </button>
              ))}
            </div>
          </div>

          {/* Emails textarea */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#374151]" htmlFor="aud-emails">
              Email addresses
            </label>
            <textarea
              id="aud-emails"
              value={emailsText}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEmailsText(e.target.value)}
              placeholder="one per line"
              rows={6}
              className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 resize-y"
            />
          </div>

          {/* Phones textarea */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#374151]" htmlFor="aud-phones">
              Phone numbers <span className="text-[#9CA3AF] font-normal">(optional)</span>
            </label>
            <textarea
              id="aud-phones"
              value={phonesText}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPhonesText(e.target.value)}
              placeholder="E.164 format, one per line"
              rows={3}
              className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30 resize-y"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-[#1B2A4A] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {submitting ? 'Uploading…' : 'Upload audience'}
          </button>

          {/* Banners */}
          {errorMsg && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {successMsg}
            </div>
          )}
        </form>
      </div>

      {/* ── Upload history card ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-5">
        <p className="text-section-header mb-4">Upload History</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB]" style={{ backgroundColor: '#F9FAFB' }}>
                <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Date</th>
                <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Operation</th>
                <th className="text-right py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Records</th>
                <th className="text-right py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Matched</th>
                <th className="text-right py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Failed</th>
                <th className="text-left py-2.5 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Status</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <SkeletonRows />
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-[#9CA3AF]">
                    No uploads yet.
                  </td>
                </tr>
              ) : (
                history.map((row: AudienceUpload) => (
                  <tr key={row.id} className="border-b border-[#E5E7EB] last:border-0">
                    <td className="py-2.5 pr-4 text-[#1A1A1A] whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td className="py-2.5 pr-4 text-[#6B7280] capitalize">
                      {row.operation_type === 'CREATE' ? 'Add' : 'Remove'}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[#1A1A1A]">
                      {row.record_count.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[#059669]">
                      {row.matched_count !== null ? row.matched_count.toLocaleString() : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[#DC2626]">
                      {row.failed_count !== null ? row.failed_count.toLocaleString() : '—'}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
