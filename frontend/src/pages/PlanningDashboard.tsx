import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';
import type { PlanningSession } from '@/types/planning';

const STATUS_LABELS: Record<PlanningSession['status'], string> = {
  pending:       'Pending',
  scanning:      'Scanning…',
  scan_complete: 'Scan Complete',
  generating:    'Generating…',
  outputs_ready: 'Ready',
  failed:        'Failed',
};

const STATUS_COLORS: Record<PlanningSession['status'], string> = {
  pending:       'bg-gray-100 text-gray-600',
  scanning:      'bg-blue-100 text-blue-700',
  scan_complete: 'bg-yellow-100 text-yellow-700',
  generating:    'bg-blue-100 text-blue-700',
  outputs_ready: 'bg-green-100 text-green-700',
  failed:        'bg-red-100 text-red-700',
};

export function PlanningDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const reset = usePlanningStore((s) => s.reset);
  const [sessions, setSessions] = useState<PlanningSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detect plan-limit redirect from Step2 (passed via router state)
  const limitReached = (location.state as { limitReached?: boolean } | null)?.limitReached ?? false;
  const limitMessage = (location.state as { limitMessage?: string } | null)?.limitMessage ?? '';

  useEffect(() => {
    planningApi
      .listSessions()
      .then(({ sessions }) => setSessions(sessions))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  function handleNew() {
    reset();
    navigate('/planning/new');
  }

  function handleOpen(session: PlanningSession) {
    reset();
    navigate(`/planning/${session.id}`);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Plan-limit upgrade banner */}
      {limitReached && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <span className="mt-0.5 text-lg">🔒</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Plan limit reached</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {limitMessage || 'You\'ve used all planning sessions included in your current plan.'}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Upgrade to <strong>Pro</strong> for 10 sessions/month, or <strong>Agency</strong> for unlimited.
            </p>
          </div>
          <Link
            to="/settings"
            className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            Upgrade plan
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planning Mode</h1>
          <p className="mt-1 text-sm text-gray-500">
            Scan your website and get a ready-to-import GTM container with AI-recommended tracking.
          </p>
        </div>
        <button
          onClick={handleNew}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          + New Plan
        </button>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-sm text-gray-400">
          Loading sessions…
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <div className="mb-3 text-4xl text-gray-300">◎</div>
          <p className="text-sm font-medium text-gray-500">No planning sessions yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Create your first plan to generate a GTM container and implementation guide.
          </p>
          <button
            onClick={handleNew}
            className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Get Started
          </button>
        </div>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {s.website_url}
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-500">
                    {s.business_type.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status]}`}
                    >
                      {STATUS_LABELS[s.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleOpen(s)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
