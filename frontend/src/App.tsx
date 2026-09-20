import { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { AppErrorBoundary, SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { PlanGate } from '@/components/common/PlanGate';
import { StrategyGateGuard } from '@/components/strategy/StrategyGateGuard';
import { BrandRedirectGuard } from '@/components/layout/BrandRedirectGuard';
import { supabase } from '@/lib/supabase';
import { dashboardApi } from '@/lib/api/dashboardApi';
import { lazyWithRetry, clearChunkReloadFlag } from '@/lib/lazyWithRetry';

const LoginPage                 = lazyWithRetry(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ShopifyWelcomePage        = lazyWithRetry(() => import('@/pages/ShopifyWelcomePage').then(m => ({ default: m.ShopifyWelcomePage })));
const ResetPasswordPage         = lazyWithRetry(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const HomePage                  = lazyWithRetry(() => import('@/pages/HomePage').then(m => ({ default: m.HomePage })));
const DashboardPage             = lazyWithRetry(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AuditProgressPage         = lazyWithRetry(() => import('@/pages/AuditProgressPage').then(m => ({ default: m.AuditProgressPage })));
const ReportPage                = lazyWithRetry(() => import('@/pages/ReportPage').then(m => ({ default: m.ReportPage })));
const JourneyBuilderPage        = lazyWithRetry(() => import('@/pages/JourneyBuilderPage').then(m => ({ default: m.JourneyBuilderPage })));
const JourneySpecPage           = lazyWithRetry(() => import('@/pages/JourneySpecPage').then(m => ({ default: m.JourneySpecPage })));
const GapReportPage             = lazyWithRetry(() => import('@/pages/GapReportPage').then(m => ({ default: m.GapReportPage })));
const PlanningDashboard         = lazyWithRetry(() => import('@/pages/PlanningDashboard').then(m => ({ default: m.PlanningDashboard })));
const PlanningModePage          = lazyWithRetry(() => import('@/pages/PlanningModePage').then(m => ({ default: m.PlanningModePage })));
const StrategyPage              = lazyWithRetry(() => import('@/pages/StrategyPage').then(m => ({ default: m.StrategyPage })));
const StrategyBriefPage         = lazyWithRetry(() => import('@/pages/StrategyBriefPage').then(m => ({ default: m.StrategyBriefPage })));
const SettingsPage              = lazyWithRetry(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const DeveloperPortalPage       = lazyWithRetry(() => import('@/pages/DeveloperPortalPage').then(m => ({ default: m.DeveloperPortalPage })));
const OrgDashboardPage          = lazyWithRetry(() => import('@/pages/OrgDashboardPage').then(m => ({ default: m.OrgDashboardPage })));
const ClientListPage            = lazyWithRetry(() => import('@/pages/ClientListPage').then(m => ({ default: m.ClientListPage })));
const ClientDetailPage          = lazyWithRetry(() => import('@/pages/ClientDetailPage').then(m => ({ default: m.ClientDetailPage })));
const SignalLibraryPage         = lazyWithRetry(() => import('@/pages/SignalLibraryPage').then(m => ({ default: m.SignalLibraryPage })));
const SignalPacksPage           = lazyWithRetry(() => import('@/pages/SignalPacksPage').then(m => ({ default: m.SignalPacksPage })));
const PackDetailPage            = lazyWithRetry(() => import('@/pages/PackDetailPage').then(m => ({ default: m.PackDetailPage })));
const OrgSettingsPage           = lazyWithRetry(() => import('@/pages/OrgSettingsPage').then(m => ({ default: m.OrgSettingsPage })));
const ConsentPage               = lazyWithRetry(() => import('@/pages/ConsentPage').then(m => ({ default: m.ConsentPage })));
const CAPIPage                  = lazyWithRetry(() => import('@/pages/CAPIPage').then(m => ({ default: m.CAPIPage })));
const EnricherPage              = lazyWithRetry(() => import('@/pages/EnricherPage').then(m => ({ default: m.EnricherPage })));
const HealthDashboardPage       = lazyWithRetry(() => import('@/pages/HealthDashboardPage'));
const ChannelInsightsPage       = lazyWithRetry(() => import('@/pages/ChannelInsightsPage').then(m => ({ default: m.ChannelInsightsPage })));
const AdminPage                 = lazyWithRetry(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));
const BillingSuccessPage        = lazyWithRetry(() => import('@/pages/BillingSuccessPage').then(m => ({ default: m.BillingSuccessPage })));
const BillingCancelPage         = lazyWithRetry(() => import('@/pages/BillingCancelPage').then(m => ({ default: m.BillingCancelPage })));
const CrawlStatusPage           = lazyWithRetry(() => import('@/pages/CrawlStatusPage').then(m => ({ default: m.CrawlStatusPage })));
const ConnectionsPage           = lazyWithRetry(() => import('@/pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const ClientConnectionsPage     = lazyWithRetry(() => import('@/pages/ClientConnectionsPage').then(m => ({ default: m.ClientConnectionsPage })));
const ReconciliationPage        = lazyWithRetry(() => import('@/pages/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const ImplementationHealthPage  = lazyWithRetry(() => import('@/pages/ImplementationHealthPage').then(m => ({ default: m.ImplementationHealthPage })));
const ReconciliationRunDetailPage = lazyWithRetry(() => import('@/pages/ReconciliationRunDetailPage').then(m => ({ default: m.ReconciliationRunDetailPage })));
const DataManagerConsolePage      = lazyWithRetry(() => import('@/pages/DataManagerConsolePage').then(m => ({ default: m.DataManagerConsolePage })));
const SignalTrackingDashboard     = lazyWithRetry(() => import('@/pages/SignalTrackingDashboard').then(m => ({ default: m.SignalTrackingDashboard })));
const SetupTrackingHubPage        = lazyWithRetry(() => import('@/pages/SetupTrackingHubPage').then(m => ({ default: m.SetupTrackingHubPage })));
const PublicDeliverableView       = lazyWithRetry(() => import('@/pages/PublicDeliverableView').then(m => ({ default: m.PublicDeliverableView })));
const GettingStartedPage          = lazyWithRetry(() => import('@/pages/GettingStartedPage').then(m => ({ default: m.GettingStartedPage })));
const HelpPage                    = lazyWithRetry(() => import('@/pages/HelpPage').then(m => ({ default: m.HelpPage })));
const PublicAuditPage             = lazyWithRetry(() => import('@/pages/PublicAuditPage').then(m => ({ default: m.PublicAuditPage })));
const PublicAuditResultsPage      = lazyWithRetry(() => import('@/pages/PublicAuditResultsPage').then(m => ({ default: m.PublicAuditResultsPage })));
const CampaignSignalValidatorLandingPage = lazyWithRetry(() => import('@/pages/CampaignSignalValidatorLandingPage').then(m => ({ default: m.CampaignSignalValidatorLandingPage })));
const CampaignSignalValidatorResultPage  = lazyWithRetry(() => import('@/pages/CampaignSignalValidatorResultPage').then(m => ({ default: m.CampaignSignalValidatorResultPage })));

const PageFallback = () => <SkeletonCard variant="page" />;

function useRecordLogin() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        dashboardApi.recordLogin().catch(() => undefined);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
}

export default function App() {
  useRecordLogin();
  useEffect(() => {
    clearChunkReloadFlag();
  }, []);
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/shopify/welcome" element={<ShopifyWelcomePage />} />

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
                <Route path="/getting-started" element={<SectionErrorBoundary label="Getting started"><GettingStartedPage /></SectionErrorBoundary>} />
                <Route path="/help" element={<SectionErrorBoundary label="Help"><HelpPage /></SectionErrorBoundary>} />
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
                {/* Bid Signal Enricher */}
                <Route path="/integrations/enricher" element={<SectionErrorBoundary label="Bid Signal Enricher"><EnricherPage /></SectionErrorBoundary>} />
                {/* Data Health Dashboard */}
                <Route path="/health" element={<SectionErrorBoundary label="Health dashboard"><HealthDashboardPage /></SectionErrorBoundary>} />
                {/* Channel Insights */}
                <Route path="/channels" element={<SectionErrorBoundary label="Channel insights"><ChannelInsightsPage /></SectionErrorBoundary>} />
                {/* Admin */}
                <Route path="/admin" element={<SectionErrorBoundary label="Admin"><AdminPage /></SectionErrorBoundary>} />
                {/* Agency Workspaces */}
                <Route path="/org/:orgId" element={<SectionErrorBoundary label="Organisation"><OrgDashboardPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/clients" element={<SectionErrorBoundary label="Clients"><BrandRedirectGuard><ClientListPage /></BrandRedirectGuard></SectionErrorBoundary>} />
                <Route path="/org/:orgId/clients/:clientId" element={<SectionErrorBoundary label="Client detail"><ClientDetailPage /></SectionErrorBoundary>} />
                <Route path="/clients/:clientId/tracking" element={<SectionErrorBoundary label="Set up tracking"><SetupTrackingHubPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/signals" element={<SectionErrorBoundary label="Tracking map"><SignalLibraryPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/packs" element={<SectionErrorBoundary label="Signal packs"><SignalPacksPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/packs/:packId" element={<SectionErrorBoundary label="Pack detail"><PackDetailPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/settings" element={<SectionErrorBoundary label="Organisation settings"><OrgSettingsPage /></SectionErrorBoundary>} />
                <Route path="/org/:orgId/data-manager" element={<SectionErrorBoundary label="Data Manager Console"><DataManagerConsolePage /></SectionErrorBoundary>} />
                <Route path="/signal-tracking" element={<SectionErrorBoundary label="Signal Tracking"><SignalTrackingDashboard /></SectionErrorBoundary>} />
                <Route path="/signal-tracking/:event_id" element={<SectionErrorBoundary label="Signal detail"><SignalTrackingDashboard /></SectionErrorBoundary>} />
              </Route>
              {/* Full-screen routes (no sidebar) */}
              <Route path="/audit/:auditId/progress" element={<SectionErrorBoundary label="Audit progress"><AuditProgressPage /></SectionErrorBoundary>} />
              <Route path="/planning/new"        element={<SectionErrorBoundary label="Set up tracking"><PlanGate minPlan="pro" featureName="Site scan"><StrategyGateGuard><PlanningModePage /></StrategyGateGuard></PlanGate></SectionErrorBoundary>} />
              <Route path="/planning/:sessionId" element={<SectionErrorBoundary label="Set up tracking"><PlanGate minPlan="pro" featureName="Site scan"><StrategyGateGuard><PlanningModePage /></StrategyGateGuard></PlanGate></SectionErrorBoundary>} />
              <Route path="/crawl/:runId" element={<SectionErrorBoundary label="Signal scan"><CrawlStatusPage /></SectionErrorBoundary>} />
            </Route>

            {/* Developer Portal — public, no auth required */}
            <Route path="/dev/:shareToken" element={<SectionErrorBoundary label="Developer portal"><DeveloperPortalPage /></SectionErrorBoundary>} />
            {/* Public deliverable share — no auth required */}
            <Route path="/share/:token" element={<PublicDeliverableView />} />
            <Route path="/audit" element={<PublicAuditPage />} />
            <Route path="/audit/results/:token" element={<PublicAuditResultsPage />} />
            {/* Campaign Signal Validator standalone product — public, no auth required */}
            <Route path="/tools/campaign-signal-validator" element={<CampaignSignalValidatorLandingPage />} />
            <Route path="/tools/campaign-signal-validator/result/:sessionId" element={<CampaignSignalValidatorResultPage />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
