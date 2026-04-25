import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { AppErrorBoundary, SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AuditProgressPage } from '@/pages/AuditProgressPage';
import { ReportPage } from '@/pages/ReportPage';
import { JourneyBuilderPage } from '@/pages/JourneyBuilderPage';
import { JourneySpecPage } from '@/pages/JourneySpecPage';
import { GapReportPage } from '@/pages/GapReportPage';
import { PlanningDashboard } from '@/pages/PlanningDashboard';
import { PlanningModePage } from '@/pages/PlanningModePage';
import { StrategyPage } from '@/pages/StrategyPage';
import { StrategyBriefPage } from '@/pages/StrategyBriefPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DeveloperPortalPage } from '@/pages/DeveloperPortalPage';
// Composable Signals & Agency Workspaces
import { OrgDashboardPage } from '@/pages/OrgDashboardPage';
import { ClientListPage } from '@/pages/ClientListPage';
import { ClientDetailPage } from '@/pages/ClientDetailPage';
import { SignalLibraryPage } from '@/pages/SignalLibraryPage';
import { SignalPacksPage } from '@/pages/SignalPacksPage';
import { PackDetailPage } from '@/pages/PackDetailPage';
import { OrgSettingsPage } from '@/pages/OrgSettingsPage';
// Consent Hub
import { ConsentPage } from '@/pages/ConsentPage';
// CAPI Integrations
import { CAPIPage } from '@/pages/CAPIPage';
// Data Health Dashboard
import HealthDashboardPage from '@/pages/HealthDashboardPage';
// Channel Signal Behaviour
import { ChannelInsightsPage } from '@/pages/ChannelInsightsPage';
// Admin
import { AdminPage } from '@/pages/AdminPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { BillingSuccessPage } from '@/pages/BillingSuccessPage';
import { BillingCancelPage } from '@/pages/BillingCancelPage';
import { PlanGate } from '@/components/common/PlanGate';
import { StrategyGateGuard } from '@/components/strategy/StrategyGateGuard';

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
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
              <Route path="/planning" element={<SectionErrorBoundary label="Planning sessions"><PlanGate minPlan="pro" featureName="Site scan"><StrategyGateGuard><PlanningDashboard /></StrategyGateGuard></PlanGate></SectionErrorBoundary>} />
              {/* Conversion Strategy Gate — all plans */}
              <Route path="/planning/strategy" element={<SectionErrorBoundary label="Strategy planner"><StrategyPage /></SectionErrorBoundary>} />
              <Route path="/strategy/briefs/:id" element={<SectionErrorBoundary label="Strategy brief"><StrategyBriefPage /></SectionErrorBoundary>} />
              {/* Settings */}
              <Route path="/settings" element={<SectionErrorBoundary label="Settings"><SettingsPage /></SectionErrorBoundary>} />
              <Route path="/settings/billing/success" element={<BillingSuccessPage />} />
              <Route path="/settings/billing/cancel" element={<BillingCancelPage />} />
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
          </Route>

          {/* Developer Portal — public, no auth required */}
          <Route path="/dev/:shareToken" element={<SectionErrorBoundary label="Developer portal"><DeveloperPortalPage /></SectionErrorBoundary>} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
