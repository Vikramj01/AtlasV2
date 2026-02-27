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
      a.download = `atlas-report-${auditId}.${format === 'json' ? 'json' : 'zip'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert(`Export not yet available. (${label})`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center">
        <p className="text-sm text-gray-400">Loading report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">{error ?? 'Report not found.'}</p>
        <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Report header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 pb-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <Link to="/dashboard" className="hover:text-brand-600">← Audits</Link>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Signal Health Report</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {new Date(report.generated_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
          </div>

          {/* Export buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleExport('pdf', 'Marketing Report')}
              disabled={exporting}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Download Marketing Report (PDF)
            </button>
            <button
              onClick={() => handleExport('json', 'Developer Report')}
              disabled={exporting}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Download Developer Report
            </button>
            <button
              disabled
              title="Share link — coming soon"
              className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
            >
              Share Link
            </button>
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
