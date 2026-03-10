import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useReport } from '@/hooks/useReport';
import { ReportNav } from '@/components/audit/ReportNav';
import { ExecutiveSummary } from '@/components/audit/ReportPages/ExecutiveSummary';
import { JourneyBreakdown } from '@/components/audit/ReportPages/JourneyBreakdown';
import { PlatformImpact } from '@/components/audit/ReportPages/PlatformImpact';
import { IssuesFixes } from '@/components/audit/ReportPages/IssuesFixes';
import { TechnicalAppendix } from '@/components/audit/ReportPages/TechnicalAppendix';
import { auditApi } from '@/lib/api/auditApi';
import { Button } from '@/components/ui/button';

export function ReportPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { report, loading, error } = useReport(auditId);
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

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
    } catch {
      alert(`Export failed for "${label}". Please try again.`);
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
        <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
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
              <Link to="/dashboard" className="hover:text-brand-600">← Audits</Link>
            </div>
            <h1 className="text-xl font-bold text-foreground">Signal Health Report</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {new Date(report.generated_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>

          {/* Export buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('pdf', 'Marketing Report')}
              disabled={exporting}
            >
              Download Marketing Report (PDF)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json', 'Developer Report')}
              disabled={exporting}
            >
              Download Developer Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Share link — coming soon"
              className="border-dashed text-muted-foreground cursor-not-allowed"
            >
              Share Link
            </Button>
          </div>
        </div>

        {/* Page navigation */}
        <ReportNav currentPage={currentPage} onPageChange={setCurrentPage} />
      </div>

      {/* Page content */}
      <div className="flex-1 px-6 py-8 max-w-5xl">
        {currentPage === 1 && <ExecutiveSummary report={report} />}
        {currentPage === 2 && <JourneyBreakdown report={report} />}
        {currentPage === 3 && <PlatformImpact report={report} />}
        {currentPage === 4 && <IssuesFixes report={report} />}
        {currentPage === 5 && <TechnicalAppendix report={report} />}
      </div>
    </div>
  );
}
