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

export function canChangeRole({ actorRole, actorId, targetId, currentTargetRole, nextRole }) {
  const actor = normalizeRole(actorRole);
  const current = normalizeRole(currentTargetRole);
  const next = normalizeRole(nextRole);
  if (actor !== ROLES.OWNER) return { ok: false, reason: 'Only owners can change user privileges.' };
  if (!current || !next) return { ok: false, reason: 'Invalid role.' };
  if (current === next) return { ok: true, reason: 'No change.' };
  if (String(actorId) === String(targetId) && current === ROLES.OWNER && next !== ROLES.OWNER) {
    return { ok: false, reason: 'Owners cannot demote their own account here.' };
  }
  if (next === ROLES.OWNER && current !== ROLES.OWNER) {
    return { ok: false, reason: 'Owner role cannot be granted from this screen.' };
  }
  return { ok: true, reason: null };
}
