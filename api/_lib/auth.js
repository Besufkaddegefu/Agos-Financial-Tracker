import { createClerkClient, verifyToken } from '@clerk/backend';
import { ROLES, hasRole, normalizeRole } from './rbac.js';

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

let _clerk = null;
function clerk() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return _clerk;
}

function displayName(user) {
  const personalName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  if (personalName) return personalName;
  const username = String(user?.username || '').trim();
  return username && !username.includes('@') ? username : null;
}

export async function getClerkDisplayNames(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const client = clerk();
  const names = new Map();
  if (!client || !ids.length) return names;

  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const result = await client.users.getUserList({ userId: batch, limit: 100 });
    for (const user of result.data || []) {
      const name = displayName(user);
      if (name) names.set(user.id, name);
    }
  }
  return names;
}

// Vercel Node serverless auth guard.
// Requires: CLERK_SECRET_KEY env var. Client sends Authorization: Bearer <session token>.
export async function requireAuth(req) {
  if (!process.env.CLERK_SECRET_KEY) {
    const err = new Error('CLERK_SECRET_KEY is not configured on the API server');
    err.status = 500;
    throw err;
  }
  const token = getBearer(req);
  if (!token) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  let userId = null;
  try {
    const verified = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    userId = verified?.sub || (typeof verified === 'object' && verified ? verified.userId : null) || null;
  } catch (e) {
    console.error('[auth] token verify failed:', e?.message || e);
    const err = new Error('Unauthorized');
    err.status = 401;
    err.details = 'Invalid or expired session token: ' + (e?.message || 'verify failed');
    throw err;
  }
  if (!userId) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  let role = ROLES.EMPLOYEE;
  let name = null;
  const c = clerk();
  if (!c) {
    const err = new Error('CLERK_SECRET_KEY is not configured on the API server');
    err.status = 500;
    throw err;
  }
  try {
    const user = await c.users.getUser(userId);
    role = normalizeRole(user?.publicMetadata?.role || user?.privateMetadata?.role) || ROLES.EMPLOYEE;
    name = displayName(user);
  } catch (error) {
    console.error('[auth] Clerk user lookup failed:', error?.message || error);
    const authError = new Error('Could not verify your account role with Clerk. Please try again.');
    authError.status = 503;
    throw authError;
  }
  return { userId, role, name };
}

export async function requireRole(req, minRole) {
  const actor = await requireAuth(req);
  if (!hasRole(actor.role, minRole)) {
    const err = new Error('Forbidden');
    err.status = 403;
    err.details = `Requires role ${minRole} or higher`;
    throw err;
  }
  return actor;
}

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(body));
}

export function handleApiError(res, error) {
  const status = Number(error?.status) || 500;
  const raw = error?.message || 'Request failed';
  const message = status >= 500 ? 'Internal server error' : raw;
  if (status >= 500) console.error('[api]', error?.stack || error);
  // Include real message in details for 500s to aid local debugging (safe in this app context).
  const details = error?.details || (status >= 500 ? raw : null);
  return json(res, status, { error: message, details, code: error?.code || null });
}
