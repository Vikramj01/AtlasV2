import { useEffect, useState, useCallback } from 'react';
import { Users, Activity, Bell, BarChart3, ChevronDown } from 'lucide-react';
import { adminApi, type AdminStats, type AdminUser, type ActivityItem, type AdminAlert } from '@/lib/api/adminApi';

type Tab = 'overview' | 'users' | 'activity' | 'alerts';

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  pro: 'bg-blue-100 text-blue-700',
  agency: 'bg-purple-100 text-purple-700',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  info: 'bg-blue-100 text-blue-700',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  running: 'bg-blue-100 text-blue-700',
  queued: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  scanning: 'bg-blue-100 text-blue-700',
  pending: 'bg-gray-100 text-gray-600',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: AdminStats }) {
  const plans = ['free', 'pro', 'agency'];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Users" value={stats.users_total} />
        {plans.map((p) => (
          <StatCard
            key={p}
            label={`${p.charAt(0).toUpperCase() + p.slice(1)} Users`}
            value={stats.users_by_plan[p] ?? 0}
          />
        ))}
        <StatCard label="Audits This Month" value={stats.audits_this_month} />
        <StatCard label="Planning Sessions" value={stats.planning_this_month} sub="this month" />
        <StatCard label="Active Alerts" value={stats.health_alerts_active} />
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersTab({
  users,
  onPlanChange,
  onDelete,
}: {
  users: AdminUser[];
  onPlanChange: (id: string, plan: string) => void;
  onDelete: (id: string) => void;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function handlePlanChange(userId: string, plan: string) {
    setChanging(userId);
    try {
      await adminApi.setUserPlan(userId, plan);
      onPlanChange(userId, plan);
    } catch {
      // silent — could add toast
    } finally {
      setChanging(null);
    }
  }

  async function handleDelete(userId: string) {
    setConfirmId(null);
    setDeleting(userId);
    try {
      await adminApi.deleteUser(userId);
      onDelete(userId);
    } catch {
      // silent — could add toast
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3 text-center">Audits</th>
            <th className="px-4 py-3 text-center">Planning</th>
            <th className="px-4 py-3">Joined</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-gray-50/50">
              <td className="px-4 py-3 font-medium text-foreground">{u.email}</td>
              <td className="px-4 py-3">
                <div className="relative inline-block">
                  <select
                    value={u.plan}
                    disabled={changing === u.id || deleting === u.id}
                    onChange={(e) => handlePlanChange(u.id, e.target.value)}
                    className={`appearance-none rounded-full px-3 py-1 pr-7 text-xs font-medium cursor-pointer border-0 outline-none ${PLAN_COLORS[u.plan] ?? 'bg-gray-100 text-gray-700'}`}
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="agency">agency</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-60" />
                </div>
              </td>
              <td className="px-4 py-3 text-center tabular-nums">{u.audit_count}</td>
              <td className="px-4 py-3 text-center tabular-nums">{u.planning_count}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(u.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                {confirmId === u.id ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">Delete?</span>
                    <button
                      onClick={() => void handleDelete(u.id)}
                      disabled={deleting === u.id}
                      className="text-xs text-red-600 hover:text-red-800 font-semibold underline disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmId(u.id)}
                    disabled={deleting === u.id}
                    className="text-xs text-muted-foreground hover:text-red-600 underline disabled:opacity-50"
                  >
                    {deleting === u.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No users found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────

function ActivityTab({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Site</th>
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={`${item.type}-${item.id}`} className="hover:bg-gray-50/50">
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.type === 'audit' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>
                  {item.type}
                </span>
              </td>
              <td className="px-4 py-3 max-w-[240px] truncate text-foreground font-medium" title={item.website_url}>
                {item.website_url}
              </td>
              <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                {item.user_id.slice(0, 8)}…
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {item.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground text-xs">{timeAgo(item.created_at)}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No activity yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────────

function AlertsTab({ alerts, onDismiss }: { alerts: AdminAlert[]; onDismiss: (id: string) => void }) {
  const [dismissing, setDismissing] = useState<string | null>(null);

  async function handleDismiss(id: string) {
    setDismissing(id);
    try {
      await adminApi.dismissAlert(id);
      onDismiss(id);
    } catch {
      // silent
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Severity</th>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Message</th>
            <th className="px-4 py-3">User</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {alerts.map((alert) => (
            <tr key={alert.id} className={`hover:bg-gray-50/50 ${!alert.is_active ? 'opacity-50' : ''}`}>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[alert.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                  {alert.severity}
                </span>
              </td>
              <td className="px-4 py-3 font-medium text-foreground max-w-[200px] truncate" title={alert.title}>
                {alert.title}
              </td>
              <td className="px-4 py-3 text-muted-foreground max-w-[280px] truncate" title={alert.message}>
                {alert.message}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {alert.user_id.slice(0, 8)}…
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${alert.is_active ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                  {alert.is_active ? 'active' : 'dismissed'}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(alert.created_at)}</td>
              <td className="px-4 py-3">
                {alert.is_active && (
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    disabled={dismissing === alert.id}
                    className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                )}
              </td>
            </tr>
          ))}
          {alerts.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No alerts.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', Icon: BarChart3 },
  { id: 'users', label: 'Users', Icon: Users },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'alerts', label: 'Alerts', Icon: Bell },
];

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [statsRes, usersRes, activityRes, alertsRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getUsers(),
        adminApi.getActivity(),
        adminApi.getAlerts(),
      ]);
      setStats(statsRes);
      setUsers(usersRes.users);
      setActivity(activityRes.items);
      setAlerts(alertsRes.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-32 text-red-600 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Platform management</p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border bg-white p-1 shadow-sm w-fit">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === 'alerts' && alerts.filter((a) => a.is_active).length > 0 && (
              <span className="ml-0.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                {alerts.filter((a) => a.is_active).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && stats && <OverviewTab stats={stats} />}
      {activeTab === 'users' && (
        <UsersTab
          users={users}
          onPlanChange={(id, plan) =>
            setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, plan } : u)))
          }
          onDelete={(id) =>
            setUsers((prev) => prev.filter((u) => u.id !== id))
          }
        />
      )}
      {activeTab === 'activity' && <ActivityTab items={activity} />}
      {activeTab === 'alerts' && (
        <AlertsTab
          alerts={alerts}
          onDismiss={(id) =>
            setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: false } : a)))
          }
        />
      )}
    </div>
  );
}
