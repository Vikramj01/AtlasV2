import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { publicAuditApi } from '@/lib/api/publicAuditApi';
import { ReportTabs } from '@/components/audit/ReportTabs';
import type { PublicAuditRun } from '@/types/publicAudit';

const GRADE_COLOURS: Record<'A' | 'B' | 'C' | 'D', { ring: string; text: string; bg: string }> = {
  A: { ring: 'ring-green-500',  text: 'text-green-600',  bg: 'bg-green-500/10'  },
  B: { ring: 'ring-yellow-500', text: 'text-yellow-600', bg: 'bg-yellow-500/10' },
  C: { ring: 'ring-orange-500', text: 'text-orange-600', bg: 'bg-orange-500/10' },
  D: { ring: 'ring-red-500',    text: 'text-red-600',    bg: 'bg-red-500/10'    },
};

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

interface Props {
  run:          PublicAuditRun;
  token:        string;
  onRunAnother?: () => void;
}

// Renders a real Check Register v2 report (the same engine an authenticated
// scan runs) for an anonymous visitor — same ReportTabs content ReportPage
// uses, wrapped in a signup CTA + email-gate instead of export/Slack/
// link-to-client actions, which need an account.
export function AuditReportCard({ run, token, onRunAnother }: Props) {
  const navigate = useNavigate();
  const report    = run.report;
  const score     = report?.executive_summary.scores.conversion_signal_health ?? null;
  const grade     = score !== null ? gradeFromScore(score) : null;
  const colours   = grade ? GRADE_COLOURS[grade] : GRADE_COLOURS.D;

  const [email, setEmail]                 = useState('');
  const [emailUnlocked, setEmailUnlocked]  = useState(false);
  const [emailError, setEmailError]        = useState('');
  const [copied, setCopied]                = useState(false);

  const shareUrl = `${window.location.origin}/audit/results/${token}`;

  async function handleEmailGate(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    try {
      await publicAuditApi.captureEmail(token, email);
      setEmailUnlocked(true);
    } catch {
      setEmailError('Could not verify email. Please try again.');
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!report) {
    return (
      <div className="max-w-2xl w-full py-8 text-center text-gray-400">
        This scan did not complete. Please try another URL.
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full space-y-6 py-8">
      {/* Score header */}
      <div className="flex items-center gap-6">
        <div className={`w-24 h-24 rounded-full ring-4 ${colours.ring} ${colours.bg} flex flex-col items-center justify-center flex-shrink-0`}>
          {score !== null ? (
            <>
              <span className={`text-3xl font-bold ${colours.text}`}>{Math.round(score)}</span>
              <span className={`text-xs ${colours.text}`}>{grade}</span>
            </>
          ) : (
            <span className="text-xs text-gray-500 text-center px-2">Score withheld</span>
          )}
        </div>
        <div>
          <p className="text-xl font-semibold text-white">
            {report.executive_summary.overall_status === 'healthy' ? 'Looking healthy'
              : report.executive_summary.overall_status === 'partially_broken' ? 'Gaps found'
              : 'Critical issues found'}
          </p>
          <p className="text-gray-400 text-sm mt-0.5 max-w-md">{report.executive_summary.business_summary}</p>
        </div>
      </div>

      {/* Report tabs — email-gated below */}
      <div className="relative">
        <div className={emailUnlocked ? '' : 'select-none pointer-events-none'}>
          <div className={`rounded-xl bg-white text-foreground overflow-hidden transition-all duration-300 ${emailUnlocked ? '' : 'blur-sm opacity-40'}`}>
            <ReportTabs report={report} />
          </div>
        </div>

        {/* Email gate overlay */}
        {!emailUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-gray-900/95 border border-gray-700 rounded-xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
              <div className="w-10 h-10 mx-auto rounded-full bg-indigo-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Unlock the full report</p>
                <p className="text-gray-400 text-xs mt-1">Enter your email to see the full breakdown and recommendations. We'll also send you a copy.</p>
              </div>
              <form onSubmit={handleEmailGate} className="space-y-2">
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 text-sm"
                />
                {emailError && <p className="text-red-400 text-xs text-left">{emailError}</p>}
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 font-medium">
                  See full report →
                </Button>
              </form>
              <p className="text-gray-600 text-xs">No spam. Report expires in 24 hours.</p>
            </div>
          </div>
        )}
      </div>

      {/* CTA section — only shown after email unlock */}
      {emailUnlocked && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 space-y-4">
          <div>
            <p className="text-white font-semibold">Get the full implementation plan</p>
            <p className="text-gray-400 text-sm mt-0.5">
              Atlas generates a complete GTM container, data layer spec, and implementation guide — ready to hand off to dev.
            </p>
          </div>
          <Button
            onClick={() => navigate('/login')}
            className="w-full bg-indigo-600 hover:bg-indigo-500 font-medium"
          >
            Start free → Get full plan
          </Button>

          <div className="border-t border-gray-700 pt-4">
            <div className="flex gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="flex-1 bg-gray-900 border-gray-700 text-gray-400 h-9 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="border-gray-600 text-gray-300 hover:text-white h-9 whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {onRunAnother && (
        <div className="text-center">
          <button
            type="button"
            onClick={onRunAnother}
            className="text-gray-500 hover:text-gray-300 text-sm underline"
          >
            Run another audit
          </button>
        </div>
      )}
    </div>
  );
}
