import React from 'react';
import { Navigate } from 'react-router-dom';
import { useRBAC } from '@/hooks/useRBAC';
import { ROLES } from '@/lib/rbac';

export function RequireAuth({ children }) {
  const { isLoaded, isSignedIn, clerkConfigured } = useRBAC();
  if (!clerkConfigured) return children; // local/dev fallback
  if (!isLoaded) return <div className="p-8 text-slate-500">Loading...</div>;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return children;
}

export function RequireRole({ minRole = ROLES.EMPLOYEE, children, fallback = null }) {
  const { isLoaded, hasRole, clerkConfigured, isSignedIn } = useRBAC();
  if (!clerkConfigured) return children;
  if (!isLoaded) return <div className="p-8 text-slate-500">Loading...</div>;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  if (!hasRole(minRole)) {
    return fallback ?? (
      <div className="p-8">
        <div className="max-w-xl mx-auto bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          <h2 className="font-semibold mb-1">Access restricted</h2>
          <p className="text-sm">You do not have permission to view this area.</p>
        </div>
      </div>
    );
  }
  return children;
}

export function OwnerOnly({ children, fallback = null }) {
  return <RequireRole minRole={ROLES.OWNER} fallback={fallback}>{children}</RequireRole>;
}
