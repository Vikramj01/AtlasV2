import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AuditProgressPage } from '@/pages/AuditProgressPage';
import { ReportPage } from '@/pages/ReportPage';
import { JourneyBuilderPage } from '@/pages/JourneyBuilderPage';

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
          </Route>
          {/* Full-page flows (no sidebar) */}
          <Route path="/audit/:auditId/progress" element={<AuditProgressPage />} />
          <Route path="/journey/new" element={<JourneyBuilderPage />} />
        </Route>

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/journey/new" replace />} />
        <Route path="*" element={<Navigate to="/journey/new" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
