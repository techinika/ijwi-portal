import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';

const InvoicePage = lazy(() =>
  import('./pages/InvoicePage').then((m) => ({ default: m.InvoicePage }))
);
const InviteAcceptPage = lazy(() =>
  import('./pages/InviteAcceptPage').then((m) => ({ default: m.InviteAcceptPage }))
);
const VerifyCertificatePage = lazy(() =>
  import('./pages/VerifyCertificatePage').then((m) => ({ default: m.VerifyCertificatePage }))
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const BookingsPage = lazy(() =>
  import('./pages/BookingsPage').then((m) => ({ default: m.BookingsPage }))
);
const ResourcesPage = lazy(() =>
  import('./pages/ResourcesPage').then((m) => ({ default: m.ResourcesPage }))
);
const SessionsAndGroupPage = lazy(() =>
  import('./pages/SessionsAndGroupPage').then((m) => ({ default: m.SessionsAndGroupPage }))
);
const TeamPage = lazy(() =>
  import('./pages/TeamPage').then((m) => ({ default: m.TeamPage }))
);
const ProgressPage = lazy(() =>
  import('./pages/ProgressPage').then((m) => ({ default: m.ProgressPage }))
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);
const TeacherPage = lazy(() =>
  import('./pages/TeacherPage').then((m) => ({ default: m.TeacherPage }))
);
const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((m) => ({ default: m.AdminPage }))
);

function RouteSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6 animate-pulse">
      <div className="h-28 rounded-[24px] bg-[#FAFBFB] border border-[#084F4E]/10" />
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="h-48 rounded-[20px] bg-white border border-[#084F4E]/10" />
        <div className="h-48 rounded-[20px] bg-white border border-[#084F4E]/10" />
      </div>
    </div>
  );
}

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
          <ToastProvider>
            <AuthProvider>
              <Layout>
                <Suspense fallback={<RouteSkeleton />}>
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
                </Suspense>
              </Layout>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
