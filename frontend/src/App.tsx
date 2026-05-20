import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { AppErrorBoundary, SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { PlanGate } from '@/components/common/PlanGate';
import { StrategyGateGuard } from '@/components/strategy/StrategyGateGuard';

const LoginPage                 = lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ResetPasswordPage         = lazy(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const HomePage                  = lazy(() => import('@/pages/HomePage').then(m => ({ default: m.HomePage })));
const DashboardPage             = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AuditProgressPage         = lazy(() => import('@/pages/AuditProgressPage').then(m => ({ default: m.AuditProgressPage })));
const ReportPage                = lazy(() => import('@/pages/ReportPage').then(m => ({ default: m.ReportPage })));
const JourneyBuilderPage        = lazy(() => import('@/pages/JourneyBuilderPage').then(m => ({ default: m.JourneyBuilderPage })));
const JourneySpecPage           = lazy(() => import('@/pages/JourneySpecPage').then(m => ({ default: m.JourneySpecPage })));
const GapReportPage             = lazy(() => import('@/pages/GapReportPage').then(m => ({ default: m.GapReportPage })));
const PlanningDashboard         = lazy(() => import('@/pages/PlanningDashboard').then(m => ({ default: m.PlanningDashboard })));
const PlanningModePage          = lazy(() => import('@/pages/PlanningModePage').then(m => ({ default: m.PlanningModePage })));
const StrategyPage              = lazy(() => import('@/pages/StrategyPage').then(m => ({ default: m.StrategyPage })));
const StrategyBriefPage         = lazy(() => import('@/pages/StrategyBriefPage').then(m => ({ default: m.StrategyBriefPage })));
const SettingsPage              = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const DeveloperPortalPage       = lazy(() => import('@/pages/DeveloperPortalPage').then(m => ({ default: m.DeveloperPortalPage })));
const OrgDashboardPage          = lazy(() => import('@/pages/OrgDashboardPage').then(m => ({ default: m.OrgDashboardPage })));
const ClientListPage            = lazy(() => import('@/pages/ClientListPage').then(m => ({ default: m.ClientListPage })));
const ClientDetailPage          = lazy(() => import('@/pages/ClientDetailPage').then(m => ({ default: m.ClientDetailPage })));
const SignalLibraryPage         = lazy(() => import('@/pages/SignalLibraryPage').then(m => ({ default: m.SignalLibraryPage })));
const SignalPacksPage           = lazy(() => import('@/pages/SignalPacksPage').then(m => ({ default: m.SignalPacksPage })));
const PackDetailPage            = lazy(() => import('@/pages/PackDetailPage').then(m => ({ default: m.PackDetailPage })));
const OrgSettingsPage           = lazy(() => import('@/pages/OrgSettingsPage').then(m => ({ default: m.OrgSettingsPage })));
const ConsentPage               = lazy(() => import('@/pages/ConsentPage').then(m => ({ default: m.ConsentPage })));
const CAPIPage                  = lazy(() => import('@/pages/CAPIPage').then(m => ({ default: m.CAPIPage })));
const HealthDashboardPage       = lazy(() => import('@/pages/HealthDashboardPage'));
const ChannelInsightsPage       = lazy(() => import('@/pages/ChannelInsightsPage').then(m => ({ default: m.ChannelInsightsPage })));
const AdminPage                 = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const BillingSuccessPage        = lazy(() => import('@/pages/BillingSuccessPage').then(m => ({ default: m.BillingSuccessPage })));
const BillingCancelPage         = lazy(() => import('@/pages/BillingCancelPage').then(m => ({ default: m.BillingCancelPage })));
const CrawlStatusPage           = lazy(() => import('@/pages/CrawlStatusPage').then(m => ({ default: m.CrawlStatusPage })));
const ConnectionsPage           = lazy(() => import('@/pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const ClientConnectionsPage     = lazy(() => import('@/pages/ClientConnectionsPage').then(m => ({ default: m.ClientConnectionsPage })));
const ReconciliationPage        = lazy(() => import('@/pages/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const ImplementationHealthPage  = lazy(() => import('@/pages/ImplementationHealthPage').then(m => ({ default: m.ImplementationHealthPage })));
const ReconciliationRunDetailPage = lazy(() => import('@/pages/ReconciliationRunDetailPage').then(m => ({ default: m.ReconciliationRunDetailPage })));

const PageFallback = () => <SkeletonCard variant="page" />;

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected — wrapped in AppLayout (sidebar + topbar) */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/"         element={<SectionErrorBoundary label="Home"><HomePage /></SectionErrorBoundary>} />
                <Route path="/home"     element={<Navigate to="/" replace />} />
                <Route path="/dashboard" element={<SectionErrorBoundary label="Dashboard"><DashboardPage /></SectionErrorBoundary>} />
                <Route path="/report/:auditId" element={<SectionErrorBoundary label="Audit report"><ReportPage /></SectionErrorBoundary>} />
                <Route path="/journey/new" element={<SectionErrorBoundary label="Journey builder"><JourneyBuilderPage /></SectionErrorBoundary>} />
                <Route path="/journey/:id/spec" element={<SectionErrorBoundary label="Journey spec"><JourneySpecPage /></SectionErrorBoundary>} />
                <Route path="/journey/:id/audit/:auditId" element={<SectionErrorBoundary label="Gap report"><GapReportPage /></SectionErrorBoundary>} />
                {/* Planning Mode — Pro+ */}
                <Route path="/planning" element={<SectionErrorBoundary label="Planning sessions"><PlanGate minPlan="pro" featureName="Site scan"><PlanningDashboard /></PlanGate></SectionErrorBoundary>} />
                {/* Conversion Strategy Gate — all plans */}
                <Route path="/planning/strategy" element={<SectionErrorBoundary label="Strategy planner"><StrategyPage /></SectionErrorBoundary>} />
                <Route path="/strategy/briefs/:id" element={<SectionErrorBoundary label="Strategy brief"><StrategyBriefPage /></SectionErrorBoundary>} />
                {/* Settings */}
                <Route path="/settings" element={<SectionErrorBoundary label="Settings"><SettingsPage /></SectionErrorBoundary>} />
                <Route path="/settings/billing/success" element={<BillingSuccessPage />} />
                <Route path="/settings/billing/cancel" element={<BillingCancelPage />} />
                <Route path="/settings/implementation-health" element={<SectionErrorBoundary label="Implementation Health"><ImplementationHealthPage /></SectionErrorBoundary>} />
                <Route path="/settings/implementation-health/gtm/callback" element={<SectionErrorBoundary label="GTM OAuth"><ImplementationHealthPage /></SectionErrorBoundary>} />
                {/* Platform Connections */}
                <Route path="/connections" element={<ConnectionsPage />} />
                <Route path="/connections/:clientId" element={<ClientConnectionsPage />} />
                <Route path="/reconciliation" element={<ReconciliationPage />} />
                <Route path="/reconciliation/:clientId" element={<ReconciliationPage />} />
                <Route path="/reconciliation/runs/:id" element={<ReconciliationRunDetailPage />} />
                {/* OAuth callback page — reads code+state from URL, calls API */}
                <Route path="/connections/oauth/:platform/callback" element={<ConnectionsPage />} />
                {/* Tag Library */}
                <Route path="/signals" element={<SectionErrorBoundary label="Tag library"><SignalLibraryPage /></SectionErrorBoundary>} />
                {/* Consent Hub */}
                <Route path="/consent" element={<SectionErrorBoundary label="Consent & Privacy"><ConsentPage /></SectionErrorBoundary>} />
                {/* CAPI Integrations */}
                <Route path="/integrations/capi" element={<SectionErrorBoundary label="Conversion API"><CAPIPage /></SectionErrorBoundary>} />
                {/* Data Health Dashboard */}
                <Route path="/health" element={<SectionErrorBoundary label="Health dashboard"><HealthDashboardPage /></SectionErrorBoundary>} />
                {/* Channel Insights */}
                <Route path="/channels" element={<SectionErrorBoundary label="Channel insights"><ChannelInsightsPage /></SectionErrorBoundary>} />
                {/* Admin */}
                <Route path="/admin" element={<SectionErrorBoundary label="Admin"><AdminPage /></SectionErrorBoundary>} />
                {/* Agency Workspaces */}
                <Route path="/org/:orgId" element={<SectionErrorBoundary label="Organisation"><OrgDashboardPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/clients" element={<SectionErrorBoundary label="Clients"><ClientListPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/clients/:clientId" element={<SectionErrorBoundary label="Client detail"><ClientDetailPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/signals" element={<SectionErrorBoundary label="Tracking map"><SignalLibraryPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/packs" element={<SectionErrorBoundary label="Signal packs"><SignalPacksPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/packs/:packId" element={<SectionErrorBoundary label="Pack detail"><PackDetailPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/settings" element={<SectionErrorBoundary label="Organisation settings"><OrgSettingsPage /></SectionErrorBoundary>} />
              </Route>
              {/* Full-screen routes (no sidebar) */}
              <Route path="/audit/:auditId/progress" element={<SectionErrorBoundary label="Audit progress"><AuditProgressPage /></SectionErrorBoundary>} />
              <Route path="/planning/new"        element={<SectionErrorBoundary label="Set up tracking"><PlanGate minPlan="pro" featureName="Site scan"><StrategyGateGuard><PlanningModePage /></StrategyGateGuard></PlanGate></SectionErrorBoundary>} />
              <Route path="/planning/:sessionId" element={<SectionErrorBoundary label="Set up tracking"><PlanGate minPlan="pro" featureName="Site scan"><StrategyGateGuard><PlanningModePage /></StrategyGateGuard></PlanGate></SectionErrorBoundary>} />
              <Route path="/crawl/:runId" element={<SectionErrorBoundary label="Signal scan"><CrawlStatusPage /></SectionErrorBoundary>} />
            </Route>

            {/* Developer Portal — public, no auth required */}
            <Route path="/dev/:shareToken" element={<SectionErrorBoundary label="Developer portal"><DeveloperPortalPage /></SectionErrorBoundary>} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
