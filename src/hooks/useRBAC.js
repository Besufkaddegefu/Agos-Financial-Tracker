import { useMemo } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import {
  ROLES,
  hasRole,
  canManagePrivileges,
  canChangeRole,
  roleFromClerkUser,
  normalizeRole,
} from '@/lib/rbac';

function useClerkRBAC() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const { user } = useUser();

  return useMemo(() => {
    const role = isSignedIn ? roleFromClerkUser(user) : null;
    return {
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      userId: userId || null,
      role,
      clerkConfigured: true,
      getToken,
      hasRole: required => hasRole(role, required),
      canManagePrivileges: canManagePrivileges(role),
      canChangeRole: args => canChangeRole({ actorRole: role, actorId: userId, ...args }),
      ROLES,
    };
  }, [isLoaded, isSignedIn, userId, user, getToken]);
}

function useLocalRBAC() {
  return useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: true, // local/dev mode: allow access, RBAC still enforced by UI logic where meaningful
      userId: 'local-dev',
      role: ROLES.OWNER, // local mode defaults to owner so features are testable
      clerkConfigured: false,
      getToken: async () => null,
      hasRole: required => hasRole(ROLES.OWNER, required),
      canManagePrivileges: true,
      canChangeRole: args => canChangeRole({ actorRole: ROLES.OWNER, actorId: 'local-dev', ...args }),
      ROLES,
    }),
    []
  );
}

export const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
export const useRBAC = clerkConfigured ? useClerkRBAC : useLocalRBAC;
export function getConfiguredClerkKey() {
  return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
}
export { normalizeRole };
