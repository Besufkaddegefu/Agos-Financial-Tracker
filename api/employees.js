import { getDb, withTransaction } from './_lib/db.js';
import { requireAuth, requireRole, json, handleApiError } from './_lib/auth.js';
import { ROLES } from './_lib/rbac.js';
import { actorName, createApproval, requiresHigherApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default async function handler(req, res) {
  try {
    const isSelfService = req.method === 'GET' && req.query?.mine === 'true';
    const actor = isSelfService
      ? await requireAuth(req)
      : await requireRole(req, ROLES.ADMIN);
    const sql = getDb();
    const { method } = req;

    if (method === 'GET') {
      if (isSelfService) {
        const rows = await sql`SELECT * FROM employees WHERE clerk_id = ${actor.userId} LIMIT 1`;
        return json(res, 200, { data: await resolveStoredNames(sql, rows) });
      }
      const id = parseId(req.query?.id);
      if (id) {
        const rows = await sql`SELECT * FROM employees WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return json(res, 404, { error: 'Employee not found' });
        const [employee] = await resolveStoredNames(sql, rows);
        return json(res, 200, { data: employee });
      }
      const employmentType = req.query?.employment_type || null;
      const status = req.query?.status || null;
      const rows = await sql`
        SELECT * FROM employees
        WHERE (${employmentType}::text IS NULL OR employment_type::text = ${employmentType})
          AND (${status}::text IS NULL OR status::text = ${status})
        ORDER BY created_at DESC`;
      return json(res, 200, { data: await resolveStoredNames(sql, rows) });
    }

    if (method === 'POST') {
      const b = req.body || {};
      if (!b.full_name || !b.email) return json(res, 400, { error: 'full_name and email are required' });
      const data = {
        clerk_id: b.clerk_id || null,
        full_name: String(b.full_name).trim(),
        email: String(b.email).trim().toLowerCase(),
        phone: b.phone || null,
        employment_type: b.employment_type || 'full_time',
        salary_type: b.salary_type || 'monthly_salary',
        base_rate: Number(b.base_rate) || 0,
        hire_date: b.hire_date || new Date().toISOString().slice(0, 10),
        status: b.status || 'active',
      };
      if (requiresHigherApproval(actor, 'employment')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'employment', entityType: 'employees',
          operation: 'create', requestedData: data,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        INSERT INTO employees (
          clerk_id, full_name, email, phone, employment_type, salary_type,
          base_rate, hire_date, status, created_by_clerk_id, created_by_name
        )
        VALUES (
          ${data.clerk_id}, ${data.full_name}, ${data.email}, ${data.phone},
          ${data.employment_type}, ${data.salary_type}, ${data.base_rate},
          ${data.hire_date}, ${data.status}, ${actor.userId}, ${await actorName(tx, actor)}
        )
        RETURNING *`;
        await writeAudit(tx, {
          actor, action: 'created', entityType: 'employees', entityId: rows[0].id,
          after: rows[0],
        });
        return rows;
      });
      return json(res, 201, { data: rows[0] });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const id = parseId(req.query?.id || req.body?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const b = req.body || {};
      const existing = await sql`SELECT * FROM employees WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Employee not found' });
      const cur = existing[0];
      const changes = {
        clerk_id: b.clerk_id !== undefined ? b.clerk_id || null : cur.clerk_id,
        full_name: b.full_name !== undefined ? String(b.full_name).trim() : cur.full_name,
        email: b.email !== undefined ? String(b.email).trim().toLowerCase() : cur.email,
        phone: b.phone !== undefined ? b.phone || null : cur.phone,
        employment_type: b.employment_type ?? cur.employment_type,
        salary_type: b.salary_type ?? cur.salary_type,
        base_rate: b.base_rate != null ? Number(b.base_rate) : Number(cur.base_rate),
        hire_date: b.hire_date ?? cur.hire_date,
        status: b.status ?? cur.status,
      };
      if (!changes.full_name || !changes.email) return json(res, 400, { error: 'full_name and email are required' });
      const employmentChanged = ['clerk_id', 'employment_type', 'hire_date', 'status'].some(key => String(changes[key] ?? '') !== String(cur[key] ?? ''));
      const compensationChanged = ['salary_type', 'base_rate'].some(key => String(changes[key] ?? '') !== String(cur[key] ?? ''));
      const category = employmentChanged ? 'employment' : compensationChanged ? 'compensation' : null;
      if (category && requiresHigherApproval(actor, category)) {
        const requestedData = Object.fromEntries(
          Object.entries(changes).filter(([key, value]) => String(value ?? '') !== String(cur[key] ?? ''))
        );
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category, entityType: 'employees', entityId: id,
          operation: 'update', requestedData, before: cur,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
          UPDATE employees SET
            clerk_id = ${changes.clerk_id},
            full_name = ${changes.full_name},
            email = ${changes.email},
            phone = ${changes.phone},
            employment_type = ${changes.employment_type},
            salary_type = ${changes.salary_type},
            base_rate = ${changes.base_rate},
            hire_date = ${changes.hire_date},
            status = ${changes.status},
            updated_by_clerk_id = ${actor.userId},
            updated_by_name = ${await actorName(tx, actor)}
          WHERE id = ${id}
          RETURNING *`;
        if (!rows[0]) return rows;
        await writeAudit(tx, {
          actor, action: 'updated', entityType: 'employees', entityId: id,
          before: cur, after: rows[0],
        });
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Employee not found' });
      return json(res, 200, { data: rows[0] });
    }

    if (method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const existing = await sql`SELECT * FROM employees WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Employee not found' });
      if (requiresHigherApproval(actor, 'employment')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'employment', entityType: 'employees', entityId: id,
          operation: 'delete', requestedData: {}, before: existing[0],
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`DELETE FROM employees WHERE id = ${id} RETURNING id`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'deleted', entityType: 'employees', entityId: id,
            before: existing[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Employee not found' });
      return json(res, 200, { data: { id } });
    }

    res.setHeader('Allow', 'GET,POST,PUT,PATCH,DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('[api/employees]', error?.stack || error);
    return handleApiError(res, error);
  }
}
