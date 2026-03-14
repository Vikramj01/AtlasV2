import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
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
import { SettingsPage } from '@/pages/SettingsPage';
import { DeveloperPortalPage } from '@/pages/DeveloperPortalPage';
// Composable Signals & Agency Workspaces
import { OrgDashboardPage } from '@/pages/OrgDashboardPage';
import { ClientListPage } from '@/pages/ClientListPage';
import { ClientDetailPage } from '@/pages/ClientDetailPage';
import { SignalLibraryPage } from '@/pages/SignalLibraryPage';
import { SignalPacksPage } from '@/pages/SignalPacksPage';
import { PackDetailPage } from '@/pages/PackDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — wrapped in AppLayout (sidebar + topbar) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/report/:auditId" element={<ReportPage />} />
            <Route path="/journey/new" element={<JourneyBuilderPage />} />
            <Route path="/journey/:id/spec" element={<JourneySpecPage />} />
            <Route path="/journey/:id/audit/:auditId" element={<GapReportPage />} />
            {/* Planning Mode */}
            <Route path="/planning" element={<PlanningDashboard />} />
            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />
            {/* Agency Workspaces */}
            <Route path="/org/:orgId" element={<OrgDashboardPage />} />
            <Route path="/org/:orgId/clients" element={<ClientListPage />} />
            <Route path="/org/:orgId/clients/:clientId" element={<ClientDetailPage />} />
            <Route path="/org/:orgId/signals" element={<SignalLibraryPage />} />
            <Route path="/org/:orgId/packs" element={<SignalPacksPage />} />
            <Route path="/org/:orgId/packs/:packId" element={<PackDetailPage />} />
          </Route>
          {/* Progress page: full-screen, no sidebar */}
          <Route path="/audit/:auditId/progress" element={<AuditProgressPage />} />
          {/* Planning wizard: full-screen, no sidebar */}
          <Route path="/planning/new" element={<PlanningModePage />} />
          <Route path="/planning/:sessionId" element={<PlanningModePage />} />
        </Route>

        {/* Developer Portal — public, no auth required */}
        <Route path="/dev/:shareToken" element={<DeveloperPortalPage />} />

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
