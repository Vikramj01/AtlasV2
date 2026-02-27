import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { AuditPage } from '@/pages/AuditPage';
import { ReportPage } from '@/pages/ReportPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/report/:auditId" element={<ReportPage />} />
        </Route>

        {/* Redirect root to audit */}
        <Route path="/" element={<Navigate to="/audit" replace />} />
        <Route path="*" element={<Navigate to="/audit" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
