import { ArrowLeftRight, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { Button } from '@/components/ui/button';

export function ReconciliationPage() {
  return (
    <SectionErrorBoundary label="Reconciliation">
      <ReconciliationPageInner />
    </SectionErrorBoundary>
  );
}

function ReconciliationPageInner() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center py-16">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EEF1F7]">
          <ArrowLeftRight className="h-8 w-8 text-[#1B2A4A]" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-3">Signal Reconciliation</h1>
        <p className="text-sm text-[#6B7280] mb-2">
          Reconciliation compares your platform-reported conversion data against your Strategy Gate briefs — surfacing discrepancies before they affect campaign performance.
        </p>
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#9CA3AF] mb-8">
          <Clock className="h-3.5 w-3.5" />
          Coming in Phase 2
        </div>
        <p className="text-xs text-[#9CA3AF] mb-6">
          To prepare, connect your ad platforms so reconciliation can pull ground-truth data when it launches.
        </p>
        <Link to="/connections">
          <Button className="bg-[#1B2A4A] text-white hover:bg-[#243660]">
            Set up Platform Connections
          </Button>
        </Link>
      </div>
    </div>
  );
}
