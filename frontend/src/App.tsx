import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AuditProgressPage } from '@/pages/AuditProgressPage';
import { ReportPage } from '@/pages/ReportPage';
import { JourneyBuilderPage } from '@/pages/JourneyBuilderPage';
import { JourneySpecPage } from '@/pages/JourneySpecPage';
import { GapReportPage } from '@/pages/GapReportPage';
import { PlanningDashboard } from '@/pages/PlanningDashboard';
import { PlanningModePage } from '@/pages/PlanningModePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — wrapped in AppLayout (sidebar + topbar) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/report/:auditId" element={<ReportPage />} />
            <Route path="/journey/new" element={<JourneyBuilderPage />} />
            <Route path="/journey/:id/spec" element={<JourneySpecPage />} />
            <Route path="/journey/:id/audit/:auditId" element={<GapReportPage />} />
            {/* Planning Mode */}
            <Route path="/planning" element={<PlanningDashboard />} />
          </Route>
          {/* Progress page: full-screen, no sidebar */}
          <Route path="/audit/:auditId/progress" element={<AuditProgressPage />} />
          {/* Planning wizard: full-screen, no sidebar */}
          <Route path="/planning/new" element={<PlanningModePage />} />
          <Route path="/planning/:sessionId" element={<PlanningModePage />} />
        </Route>

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/journey/new" replace />} />
        <Route path="*" element={<Navigate to="/journey/new" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
