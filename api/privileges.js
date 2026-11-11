import { createClerkClient } from '@clerk/backend';
import { requireRole, json, handleApiError } from './_lib/auth.js';
import { ROLES, canChangeRole, normalizeRole } from './_lib/rbac.js';
import { getDb, withTransaction } from './_lib/db.js';
import { actorName, writeAudit } from './_lib/workflow.js';

let _clerk = null;
function clerk() {
  if (!process.env.CLERK_SECRET_KEY) return null;
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return _clerk;
}

// Owner-only privilege management screen backend.
export default async function handler(req, res) {
  try {
    const actor = await requireRole(req, ROLES.OWNER);
    const c = clerk();
    if (!c) return json(res, 500, { error: 'CLERK_SECRET_KEY is not configured on the API server' });
    const { method } = req;

    if (method === 'GET') {
      const users = await c.users.getUserList({ limit: 100, orderBy: '-created_at' });
      const clerkUsers = users?.data || users || [];
      const userIds = clerkUsers.map(user => user.id);
      const sql = getDb();
      const linkedEmployees = userIds.length
        ? await sql`
            SELECT id, clerk_id, full_name
            FROM employees
            WHERE clerk_id = ANY(${userIds}::text[])`
        : [];
      const employeeByUserId = new Map(linkedEmployees.map(employee => [employee.clerk_id, employee]));
      const data = clerkUsers.map(u => ({
        id: u.id,
        email: u.emailAddresses?.[0]?.emailAddress || null,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || (u.username && !u.username.includes('@') ? u.username : 'Unknown user'),
        role: normalizeRole(u.publicMetadata?.role || u.privateMetadata?.role) || ROLES.EMPLOYEE,
        employeeId: employeeByUserId.get(u.id)?.id || null,
        employeeName: employeeByUserId.get(u.id)?.full_name || null,
        createdAt: u.createdAt,
      }));
      return json(res, 200, { data });
    }

    if (method === 'PATCH') {
      const { targetUserId, role: nextRole, action, employeeId } = req.body || {};
      if (action === 'link-employee') {
        if (!targetUserId || !Number.isSafeInteger(Number(employeeId)) || Number(employeeId) <= 0) {
          return json(res, 400, { error: 'A valid account and employee profile are required.' });
        }
        await c.users.getUser(targetUserId);
        const sql = getDb();
        const result = await withTransaction(async tx => {
          const employees = await tx`
            SELECT * FROM employees WHERE id = ${Number(employeeId)} LIMIT 1`;
          const employee = employees[0];
          if (!employee) {
            const error = new Error('Employee profile not found.');
            error.status = 404;
            throw error;
          }
          if (employee.clerk_id && employee.clerk_id !== targetUserId) {
            const error = new Error('This employee profile is already linked to another account.');
            error.status = 409;
            throw error;
          }
          const existingLink = await tx`
            SELECT id FROM employees
            WHERE clerk_id = ${targetUserId} AND id <> ${Number(employeeId)}
            LIMIT 1`;
          if (existingLink[0]) {
            const error = new Error('This account is already linked to a different employee profile.');
            error.status = 409;
            throw error;
          }
          const updated = await tx`
            UPDATE employees
            SET clerk_id = ${targetUserId},
                updated_by_clerk_id = ${actor.userId},
                updated_by_name = ${await actorName(tx, actor)}
            WHERE id = ${Number(employeeId)}
            RETURNING *`;
          await writeAudit(tx, {
            actor,
            action: 'account_linked',
            entityType: 'employees',
            entityId: updated[0].id,
            before: employee,
            after: updated[0],
          });
          return updated[0];
        });
        return json(res, 200, { data: { id: result.id, full_name: result.full_name, clerk_id: result.clerk_id } });
      }

      if (!targetUserId || !nextRole) return json(res, 400, { error: 'targetUserId and role required' });
      const target = await c.users.getUser(targetUserId);
      const currentTargetRole = normalizeRole(target?.publicMetadata?.role || target?.privateMetadata?.role) || ROLES.EMPLOYEE;
      const decision = canChangeRole({ actorRole: actor.role, actorId: actor.userId, targetId: targetUserId, currentTargetRole, nextRole });
      if (!decision.ok) return json(res, 403, { error: decision.reason });
      if (decision.reason === 'No change') return json(res, 200, { data: { id: targetUserId, role: currentTargetRole } });
      const updated = await c.users.updateUserMetadata(targetUserId, {
        publicMetadata: { ...(target.publicMetadata || {}), role: normalizeRole(nextRole) },
      });
      return json(res, 200, { data: { id: updated.id, role: normalizeRole(updated.publicMetadata?.role) || ROLES.EMPLOYEE } });
    }

    res.setHeader('Allow', 'GET,PATCH');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(res, error);
  }
}
