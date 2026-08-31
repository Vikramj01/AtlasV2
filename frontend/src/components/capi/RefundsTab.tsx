/**
 * RefundsTab — record a refund, see delivery status, download the Google
 * adjustment CSV. Rendered inside CAPIMonitoringDashboard when
 * provider === 'google' and tab === 'refunds'.
 *
 * Two independent Google-side legs (see backend/src/services/capi/refundDelivery.ts
 * for why there's no single "send the refund" call — DMA has no conversion-
 * adjustment capability):
 *   - Audience removal: real, automatic, shown as a status badge below.
 *   - Adjustment CSV: best-effort format, downloaded and uploaded by the
 *     client themselves in their own Google Ads account — Atlas can't see
 *     whether they actually did.
 */

import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { refundsApi } from '@/lib/api/refundsApi';
import type { RefundEvent, GoogleRemovalStatus } from '@/types/refunds';

const STATUS_BADGE: Record<GoogleRemovalStatus, string> = {
  removed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  skipped: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<GoogleRemovalStatus, string> = {
  removed: 'Removed from audience',
  failed: 'Removal failed',
  pending: 'Removing…',
  skipped: 'Skipped (no email/phone)',
};

function StatusBadge({ status }: { status: GoogleRemovalStatus }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-[#E5E7EB]">
          {[0, 1, 2, 3, 4].map((j) => (
            <td key={j} className="py-3 px-0">
              <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: j === 0 ? '6rem' : '4rem' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function RefundsTab() {
  // Form state
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [isPartial, setIsPartial] = useState(false);
  const [newConversionValue, setNewConversionValue] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<RefundEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      setHistory(await refundsApi.list());
    } catch {
      // leave current history in place on error
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => { void loadHistory(); }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    const parsedAmount = Number(amount);
    if (!orderId.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Order ID and a positive refund amount are required.');
      return;
    }

    let parsedNewValue: number | undefined;
    if (isPartial) {
      parsedNewValue = Number(newConversionValue);
      if (!Number.isFinite(parsedNewValue) || parsedNewValue < 0) {
        setErrorMsg('For a partial refund, enter the order’s new total after the refund.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await refundsApi.record({
        original_transaction_id: orderId.trim(),
        refund_amount: parsedAmount,
        currency: currency.trim().toUpperCase(),
        is_partial: isPartial,
        new_conversion_value: parsedNewValue,
        reason: reason.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setSuccessMsg('Refund recorded. Google audience removal is running in the background.');
      setOrderId('');
      setAmount('');
      setIsPartial(false);
      setNewConversionValue('');
      setReason('');
      setEmail('');
      setPhone('');
      await loadHistory();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to record refund. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownloadCsv(refund: RefundEvent) {
    try {
      await refundsApi.downloadAdjustmentCsv(refund.id, `refund-adjustment-${refund.original_transaction_id}.csv`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download adjustment CSV.');
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Record refund form ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-5">
        <p className="text-section-header mb-1">Record a Refund</p>
        <p className="text-xs text-[#9CA3AF] mb-4">
          Removes the customer from Google Ads remarketing/Customer Match audiences automatically.
          Doesn't correct Google Ads' own conversion reporting — Google's Data Manager API has no
          adjustment capability, so a best-effort adjustment CSV is generated for you to upload
          yourself via Google Ads → Uploads → Conversion Adjustments.{' '}
          <strong>Verify the CSV's column headers against your own account's downloaded template
          before uploading</strong> — Atlas couldn't confirm the exact format against Google's docs.
        </p>

        <form onSubmit={(e: FormEvent<HTMLFormElement>) => { void handleSubmit(e); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-order-id">
                Order ID
              </label>
              <input
                id="refund-order-id"
                type="text"
                value={orderId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setOrderId(e.target.value)}
                placeholder="ORDER-12345"
                className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-amount">
                Refund Amount
              </label>
              <div className="flex gap-2">
                <input
                  id="refund-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                  placeholder="99.99"
                  className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                  required
                />
                <input
                  type="text"
                  value={currency}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrency(e.target.value)}
                  placeholder="USD"
                  maxLength={3}
                  className="w-20 rounded-md border border-[#D1D5DB] px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#374151]">
            <input
              type="checkbox"
              checked={isPartial}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setIsPartial(e.target.checked)}
              className="rounded border-[#D1D5DB]"
            />
            This is a partial refund
          </label>

          {isPartial && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-new-value">
                Order's New Total (after this refund)
              </label>
              <input
                id="refund-new-value"
                type="number"
                step="0.01"
                min="0"
                value={newConversionValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewConversionValue(e.target.value)}
                placeholder="e.g. original 99.99 minus this refund"
                className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
                required
              />
              <p className="text-xs text-[#9CA3AF]">
                Google needs the corrected order total, not just the refund amount — Atlas doesn't
                have the original order value on file.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-reason">
              Reason <span className="text-[#9CA3AF] font-normal">(optional)</span>
            </label>
            <input
              id="refund-reason"
              type="text"
              value={reason}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
              placeholder="e.g. Item returned"
              className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-email">
                Customer Email <span className="text-[#9CA3AF] font-normal">(for audience removal)</span>
              </label>
              <input
                id="refund-email"
                type="email"
                value={email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-[#374151]" htmlFor="refund-phone">
                Customer Phone <span className="text-[#9CA3AF] font-normal">(optional)</span>
              </label>
              <input
                id="refund-phone"
                type="text"
                value={phone}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                placeholder="+15551234567"
                className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-[#1B2A4A] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {submitting ? 'Recording…' : 'Record refund'}
          </button>

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

      {/* ── Refund history ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white px-5 py-5">
        <p className="text-section-header mb-4">Refund History</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB]" style={{ backgroundColor: '#F9FAFB' }}>
                <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Date</th>
                <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Order ID</th>
                <th className="text-right py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Amount</th>
                <th className="text-left py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Google</th>
                <th className="text-left py-2.5 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Adjustment CSV</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <SkeletonRows />
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-[#9CA3AF]">
                    No refunds recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id} className="border-b border-[#E5E7EB] last:border-0">
                    <td className="py-2.5 pr-4 text-[#1A1A1A] whitespace-nowrap">
                      {new Date(row.created_at).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td className="py-2.5 pr-4 text-[#1A1A1A] font-mono text-xs">
                      {row.original_transaction_id}
                      {row.is_partial && <span className="ml-1.5 text-[#9CA3AF]">(partial)</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-[#1A1A1A]">
                      {row.refund_amount.toFixed(2)} {row.currency}
                    </td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={row.google_removal_status} />
                    </td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => void handleDownloadCsv(row)}
                        className="text-xs font-medium text-[#1B2A4A] hover:underline"
                      >
                        Download
                      </button>
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
