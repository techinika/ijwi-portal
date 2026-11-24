import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { InvoicePage } from './pages/InvoicePage';
import { InviteAcceptPage } from './pages/InviteAcceptPage';
import { VerifyCertificatePage } from './pages/VerifyCertificatePage';
import { DashboardPage } from './pages/DashboardPage';
import { BookingsPage } from './pages/BookingsPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { SessionsAndGroupPage } from './pages/SessionsAndGroupPage';
import { TeamPage } from './pages/TeamPage';
import { ProgressPage } from './pages/ProgressPage';
import { ProfilePage } from './pages/ProfilePage';
import { TeacherPage } from './pages/TeacherPage';
import { AdminPage } from './pages/AdminPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/invoices/:id" element={<InvoicePage />} />
                <Route path="/invite/:token" element={<InviteAcceptPage />} />
                <Route path="/verify/:code" element={<VerifyCertificatePage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/bookings" element={<BookingsPage />} />
                <Route path="/resources" element={<ResourcesPage />} />
                <Route path="/sessions" element={<SessionsAndGroupPage />} />
                <Route path="/group" element={<SessionsAndGroupPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/progress" element={<ProgressPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/teacher" element={<TeacherPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
