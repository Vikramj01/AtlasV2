import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { useReport } from '@/hooks/useReport';
import { ReportNav } from '@/components/audit/ReportNav';
import { ExecutiveSummary } from '@/components/audit/ReportPages/ExecutiveSummary';
import { OpenQuestions } from '@/components/audit/ReportPages/OpenQuestions';
import { JourneyBreakdown } from '@/components/audit/ReportPages/JourneyBreakdown';
import { PlatformImpact } from '@/components/audit/ReportPages/PlatformImpact';
import { IssuesFixes } from '@/components/audit/ReportPages/IssuesFixes';
import { ContentQualityWarningBanner } from '@/components/audit/ContentQualityWarningBanner';
import { SiteSetup } from '@/components/audit/ReportPages/SiteSetup';
import { HowToReadThisReport } from '@/components/audit/ReportPages/HowToReadThisReport';
import { TechnicalAppendix } from '@/components/audit/ReportPages/TechnicalAppendix';
import { auditApi } from '@/lib/api/auditApi';
import { slackApi } from '@/lib/api/slackApi';
import { Button } from '@/components/ui/button';
import { ShareToSlackButton } from '@/components/common/ShareToSlackButton';
import { LinkToClientButton } from '@/components/audit/LinkToClientButton';

export function ReportPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const { report, loading, error } = useReport(auditId);
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Open Questions (Report Honesty PRD §B3) only gets a tab when this run
  // actually raised one — an empty tab whose page just says "nothing to
  // ask" is worse than not showing the tab at all. Ids are assigned by
  // position after filtering, not hardcoded, so this conditional section
  // never has to be kept in sync with a second numbering elsewhere.
  const sections = report
    ? [
        { label: 'Executive Summary', show: true, render: () => <ExecutiveSummary report={report} /> },
        { label: 'Open Questions', show: (report.open_questions?.length ?? 0) > 0, render: () => <OpenQuestions report={report} /> },
        { label: 'Journey Breakdown', show: true, render: () => <JourneyBreakdown report={report} /> },
        { label: 'Platform Impact', show: true, render: () => <PlatformImpact report={report} /> },
        { label: 'Issues & Fixes', show: true, render: () => <IssuesFixes report={report} /> },
        { label: 'Site Setup', show: true, render: () => <SiteSetup report={report} /> },
        { label: 'How to Read This Report', show: true, render: () => <HowToReadThisReport /> },
        { label: 'Technical Appendix', show: true, render: () => <TechnicalAppendix report={report} /> },
      ]
    : [];
  const pages = sections.filter((s) => s.show).map((s, i) => ({ id: i + 1, label: s.label, render: s.render }));

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
            </h1>
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
            <ShareToSlackButton
              onShare={(destinationId) => slackApi.shareAudit(auditId!, destinationId).then(() => undefined)}
            />
          </div>
        </div>

        {/* Page navigation */}
        <ReportNav pages={pages} currentPage={currentPage} onPageChange={setCurrentPage} />
      </div>

      {/* Page content */}
      <div className="flex-1 px-6 py-8 max-w-5xl">
        {report.content_quality_warning && (
          <div className="mb-6">
            <ContentQualityWarningBanner warning={report.content_quality_warning} />
          </div>
        )}
        {pages.find((p) => p.id === currentPage)?.render()}
      </div>
    </div>
  );
}
