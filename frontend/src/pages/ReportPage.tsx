import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { useReport } from '@/hooks/useReport';
import { ReportTabs } from '@/components/audit/ReportTabs';
import { auditApi } from '@/lib/api/auditApi';
import { slackApi } from '@/lib/api/slackApi';
import { Button } from '@/components/ui/button';
import { ShareToSlackButton } from '@/components/common/ShareToSlackButton';
import { LinkToClientButton } from '@/components/audit/LinkToClientButton';

export function ReportPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { report, loading, error } = useReport(auditId);
  const [exporting, setExporting] = useState(false);

  // Settle contract & run quality (Pre-Connection Scan Confidence Tiering
  // PRD §7.3) — stated in the report header, not a footnote. An
  // INSUFFICIENT run blocks export server-side (POST /:audit_id/export
  // returns 409); disabling the buttons here is a UX courtesy, not the
  // actual gate.
  const runQuality = report?.executive_summary.coverage?.run_quality;
  const exportBlocked = runQuality === 'INSUFFICIENT';

  // Pre-Connection Scan Confidence Tiering PRD §11.1 — see the header JSX
  // below for the full rationale; matches pdfGenerator.ts's own naming.
  const reportTitle = report?.rule_set_version === 'v2' ? 'Signal Observation Report' : 'Signal Health Report';

  const handleExport = async (format: 'pdf' | 'json' | 'both', label: string) => {
    if (!auditId) return;
    setExporting(true);
    try {
      const blob = await auditApi.export(auditId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'json' ? 'json' : format === 'pdf' ? 'pdf' : 'zip';
      a.download = `atlas-report-${auditId}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Export failed for "${label}". Please try again.`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error ?? 'Report not found.'}</p>
        <Link to="/dashboard" className="text-sm font-medium text-[#1B2A4A] hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Report header */}
      <div className="border-b bg-background px-6 pt-5 pb-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground/60 mb-1">
              <Link to="/dashboard" className="hover:text-[#1B2A4A]">← Audits</Link>
            </div>
            <h1 className="text-xl font-bold text-foreground">
              {SECTION_LABELS.auditEngine.primary}
              <span className="text-muted-foreground text-sm font-normal ml-2">{SECTION_LABELS.auditEngine.technical}</span>
              {runQuality && runQuality !== 'COMPLETE' && (
                <span
                  className={`ml-2 align-middle rounded-full px-2 py-0.5 text-xs font-medium ${
                    runQuality === 'INSUFFICIENT'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {runQuality === 'INSUFFICIENT' ? 'Insufficient run quality' : 'Provisional run quality'}
                </span>
              )}
            </h1>
            {/* Pre-Connection Scan Confidence Tiering PRD §11.1 — pre-
                connection output is renamed "Signal Observation Report";
                "Signal Health Report" is reserved for a connected
                (post-access) run. Matches the PDF export's own title
                (pdfGenerator.ts). */}
            <p className="mt-0.5 text-sm font-medium text-muted-foreground/80">
              {reportTitle}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Date(report.generated_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>

          {/* Export buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {auditId && <LinkToClientButton auditId={auditId} />}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('pdf', 'Marketing Report')}
              disabled={exporting || exportBlocked}
              title={exportBlocked ? 'This scan did not settle enough of the site to export a client-facing report — re-run with corrected seed URLs.' : undefined}
            >
              Download Marketing Report (PDF)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json', 'Developer Report')}
              disabled={exporting || exportBlocked}
              title={exportBlocked ? 'This scan did not settle enough of the site to export a client-facing report — re-run with corrected seed URLs.' : undefined}
            >
              Download Developer Report
            </Button>
            <ShareToSlackButton
              onShare={(destinationId) => slackApi.shareAudit(auditId!, destinationId).then(() => undefined)}
            />
          </div>
        </div>
      </div>

      <ReportTabs report={report} />
    </div>
  );
}
