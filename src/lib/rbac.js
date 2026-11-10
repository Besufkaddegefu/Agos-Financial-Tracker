// Role-Based Access Control (RBAC) for Agos Postpartum Care
// Hierarchy (highest -> lowest): owner > admin > employee
// "Controlled decrease" pattern: privilege changes that reduce authority require
// owner role and cannot demote the last/acting owner; promotions/demotions are
// explicit, auditable operations.

export const ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
});

export const ROLE_RANK = Object.freeze({
  [ROLES.OWNER]: 3,
  [ROLES.ADMIN]: 2,
  [ROLES.EMPLOYEE]: 1,
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.OWNER]: 'Owner',
  [ROLES.ADMIN]: 'Administrator',
  [ROLES.EMPLOYEE]: 'Employee',
});

export function normalizeRole(role) {
  if (!role) return null;
  const r = String(role).toLowerCase().trim();
  return Object.values(ROLES).includes(r) ? r : null;
}

export function hasRole(userRole, requiredRole) {
  const u = ROLE_RANK[normalizeRole(userRole)] || 0;
  const req = ROLE_RANK[normalizeRole(requiredRole)] || 0;
  return u >= req && req > 0;
}

export function canManagePrivileges(actorRole) {
  return normalizeRole(actorRole) === ROLES.OWNER;
}

// Controlled decrease: only owner can change roles; cannot remove own owner role
// via demotion endpoint; cannot assign owner unless already owner (owner transfer
// should be a separate explicit flow). Demoting admin->employee is allowed for owner.
export function canChangeRole({ actorRole, actorId, targetId, currentTargetRole, nextRole }) {
  const actor = normalizeRole(actorRole);
  const current = normalizeRole(currentTargetRole);
  const next = normalizeRole(nextRole);
  if (actor !== ROLES.OWNER) return { ok: false, reason: 'Only owners can change user privileges.' };
  if (!current || !next) return { ok: false, reason: 'Invalid role.' };
  if (current === next) return { ok: true, reason: 'No change.' };

  // Prevent self-demotion from owner through this screen (controlled decrease).
  if (String(actorId) === String(targetId) && current === ROLES.OWNER && next !== ROLES.OWNER) {
    return { ok: false, reason: 'Owners cannot demote their own account here. Use an owner transfer flow.' };
  }

  // Disallow granting owner role through admin management screen to avoid accidental escalation.
  if (next === ROLES.OWNER && current !== ROLES.OWNER) {
    return { ok: false, reason: 'Owner role cannot be granted from this screen.' };
  }

  return { ok: true, reason: null };
}

export function roleFromClerkUser(user) {
  // Match the server's trusted Clerk metadata sources; unsafeMetadata is user-editable.
  const metaRole = user?.publicMetadata?.role || user?.privateMetadata?.role || null;
  return normalizeRole(metaRole) || ROLES.EMPLOYEE;
}
