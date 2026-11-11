import React, { useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { SignIn, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import { ToastProvider } from './components/ui/toast';
import Layout from './Layout';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Customers from './pages/Customers';
import Reports from './pages/Reports';
import HRPayroll from './pages/HRPayroll';
import MyRequests from './pages/MyRequests';
import { RequireRole } from './components/AuthGuard';
import { ROLES } from './lib/rbac';
import { configureEntityDataSource } from './entities/all';

// Import standalone test suite to make it globally available
import './utils/testSuiteStandalone.js';

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
// DB mode is opt-in to avoid breaking existing local/Vite-only usage.
// Set VITE_USE_API=true (and run vercel dev / deploy API) to use Neon via /api.
const useApi = String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';

function Protected({ minRole, children }) {
  if (!clerkConfigured) return children;
  return (
    <>
      <SignedOut><Navigate to="/sign-in" replace /></SignedOut>
      <SignedIn><RequireRole minRole={minRole}>{children}</RequireRole></SignedIn>
    </>
  );
}

function EntityDataSourceBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  useEffect(() => {
    configureEntityDataSource({
      dbEnabled: Boolean(useApi && isLoaded && isSignedIn),
      getToken: async () => {
        try { return await getToken(); } catch { return null; }
      },
    });
  }, [isLoaded, isSignedIn, getToken]);
  return null;
}

function AppRoutes() {
  return (
    <>
      {clerkConfigured ? <EntityDataSourceBridge /> : null}
      <Routes>
        {clerkConfigured && (
          <Route path="/sign-in/*" element={<div className="min-h-screen flex items-center justify-center bg-slate-50 p-4"><SignIn routing="path" path="/sign-in" /></div>} />
        )}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
              <Route path="/customers" element={<Protected><Customers /></Protected>} />
              <Route path="/reports" element={<Protected minRole={ROLES.EMPLOYEE}><Reports /></Protected>} />
              <Route path="/hr-payroll" element={<Protected minRole={ROLES.ADMIN}><HRPayroll /></Protected>} />
              <Route path="/my-requests" element={<Protected minRole={ROLES.EMPLOYEE}><MyRequests /></Protected>} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </>
  );
}

function App() {
  return (
    <ToastProvider>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRoutes />
      </Router>
    </ToastProvider>
  );
}

export default App;
