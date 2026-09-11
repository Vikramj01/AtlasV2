import { useState } from 'react';
import type { ReportJSON } from '@/types/audit';
import { ReportNav } from '@/components/audit/ReportNav';
import { ExecutiveSummary } from '@/components/audit/ReportPages/ExecutiveSummary';
import { OpenQuestions } from '@/components/audit/ReportPages/OpenQuestions';
import { JourneyBreakdown } from '@/components/audit/ReportPages/JourneyBreakdown';
import { PlatformImpact } from '@/components/audit/ReportPages/PlatformImpact';
import { IssuesFixes } from '@/components/audit/ReportPages/IssuesFixes';
import { SignalsInConflict } from '@/components/audit/ReportPages/SignalsInConflict';
import { NotAssessed } from '@/components/audit/ReportPages/NotAssessed';
import { WithAccess } from '@/components/audit/ReportPages/WithAccess';
import { ContentQualityWarningBanner } from '@/components/audit/ContentQualityWarningBanner';
import { SiteSetup } from '@/components/audit/ReportPages/SiteSetup';
import { HowToReadThisReport } from '@/components/audit/ReportPages/HowToReadThisReport';
import { TechnicalAppendix } from '@/components/audit/ReportPages/TechnicalAppendix';

/**
 * Shared tab navigation + page content for a ReportJSON — used by both the
 * authenticated ReportPage (with export/Slack/link-to-client actions in its
 * own header) and the public no-login results page (no such actions, since
 * there's no account or client to attach to). Extracted so the two don't
 * carry two copies of the same section list that can drift apart.
 */
export function ReportTabs({ report }: { report: ReportJSON }) {
  const [currentPage, setCurrentPage] = useState(1);

  // Open Questions, Signals in Conflict, Not Assessed, and With Access each
  // only get a tab when this run actually raised something for them — an
  // empty tab whose page just says "nothing here" is worse than not
  // showing the tab at all. Ids are assigned by position after filtering,
  // not hardcoded, so this list never has to be kept in sync with a second
  // numbering elsewhere.
  const sections = [
    { label: 'Executive Summary', show: true, render: () => <ExecutiveSummary report={report} /> },
    { label: 'Journey Breakdown', show: true, render: () => <JourneyBreakdown report={report} /> },
    { label: 'Platform Impact', show: true, render: () => <PlatformImpact report={report} /> },
    { label: 'Issues & Fixes', show: true, render: () => <IssuesFixes report={report} /> },
    { label: 'Signals in Conflict', show: (report.signal_conflicts?.length ?? 0) > 0, render: () => <SignalsInConflict report={report} /> },
    { label: 'Open Questions', show: (report.open_questions?.length ?? 0) > 0, render: () => <OpenQuestions report={report} /> },
    { label: 'Not Assessed', show: (report.could_not_be_assessed?.length ?? 0) > 0, render: () => <NotAssessed report={report} /> },
    { label: 'With Access', show: (report.with_access?.length ?? 0) > 0, render: () => <WithAccess report={report} /> },
    { label: 'Site Setup', show: true, render: () => <SiteSetup report={report} /> },
    { label: 'How to Read This Report', show: true, render: () => <HowToReadThisReport /> },
    { label: 'Technical Appendix', show: true, render: () => <TechnicalAppendix report={report} /> },
  ];
  const pages = sections.filter((s) => s.show).map((s, i) => ({ id: i + 1, label: s.label, render: s.render }));

  return (
    <div className="flex flex-col">
      <ReportNav pages={pages} currentPage={currentPage} onPageChange={setCurrentPage} />
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
