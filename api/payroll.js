import { getDb, withTransaction } from './_lib/db.js';
import { requireRole, json, handleApiError } from './_lib/auth.js';
import { ROLES } from './_lib/rbac.js';
import { actorName, createApproval, requiresHigherApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default async function handler(req, res) {
  try {
    const actor = await requireRole(req, ROLES.ADMIN);
    const sql = getDb();
    const { method } = req;

    if (method === 'GET') {
      const id = parseId(req.query?.id);
      if (id) {
        const rows = await sql`SELECT * FROM payroll_runs WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return json(res, 404, { error: 'Payroll run not found' });
        const [record] = await resolveStoredNames(sql, rows);
        return json(res, 200, { data: record });
      }
      const employeeId = parseId(req.query?.employee_id);
      const rows = employeeId
        ? await sql`
            SELECT p.*, e.full_name AS employee_name
            FROM payroll_runs p
            JOIN employees e ON e.id = p.employee_id
            WHERE p.employee_id = ${employeeId}
            ORDER BY p.pay_period_end DESC`
        : await sql`
            SELECT p.*, e.full_name AS employee_name
            FROM payroll_runs p
            JOIN employees e ON e.id = p.employee_id
            ORDER BY p.pay_period_end DESC LIMIT 500`;
      return json(res, 200, { data: await resolveStoredNames(sql, rows) });
    }

    if (method === 'POST') {
      const b = req.body || {};
      const employeeId = parseId(b.employee_id);
      const gross = Number(b.gross_pay) || 0;
      const deductions = Number(b.deductions) || 0;
      const net = b.net_pay != null ? Number(b.net_pay) : gross - deductions;
      if (!employeeId || !b.pay_period_start || !b.pay_period_end) {
        return json(res, 400, { error: 'employee_id, pay_period_start, pay_period_end required' });
      }
      const data = {
        employee_id: employeeId,
        pay_period_start: b.pay_period_start,
        pay_period_end: b.pay_period_end,
        total_units: Number(b.total_units) || 0,
        gross_pay: gross,
        deductions,
        net_pay: net,
        status: b.status || 'draft',
      };
      if (requiresHigherApproval(actor, 'payroll')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'payroll', entityType: 'payroll_runs',
          operation: 'create', requestedData: data,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        INSERT INTO payroll_runs (
          employee_id, pay_period_start, pay_period_end, total_units, gross_pay,
          deductions, net_pay, status, created_by_clerk_id, created_by_name
        )
        VALUES (
          ${employeeId}, ${b.pay_period_start}, ${b.pay_period_end}, ${Number(b.total_units) || 0},
          ${gross}, ${deductions}, ${net}, ${b.status || 'draft'},
          ${actor.userId}, ${await actorName(tx, actor)}
        )
        RETURNING *`;
        await writeAudit(tx, {
          actor, action: 'created', entityType: 'payroll_runs',
          entityId: rows[0].id, after: rows[0],
        });
        return rows;
      });
      return json(res, 201, { data: rows[0] });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const id = parseId(req.query?.id || req.body?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const b = req.body || {};
      const existing = await sql`SELECT * FROM payroll_runs WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Payroll run not found' });
      const cur = existing[0];
      const changes = {
        total_units: b.total_units != null ? Number(b.total_units) : Number(cur.total_units),
        gross_pay: b.gross_pay != null ? Number(b.gross_pay) : Number(cur.gross_pay),
        deductions: b.deductions != null ? Number(b.deductions) : Number(cur.deductions),
        net_pay: b.net_pay != null ? Number(b.net_pay) : Number(cur.net_pay),
        status: b.status ?? cur.status,
      };
      if (requiresHigherApproval(actor, 'payroll')) {
        const requestedData = Object.fromEntries(
          Object.entries(changes).filter(([key, value]) => String(value ?? '') !== String(cur[key] ?? ''))
        );
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'payroll', entityType: 'payroll_runs',
          entityId: id, operation: 'update', requestedData, before: cur,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        UPDATE payroll_runs SET
          total_units = ${changes.total_units},
          gross_pay = ${changes.gross_pay},
          deductions = ${changes.deductions},
          net_pay = ${changes.net_pay},
          status = ${changes.status},
          updated_by_clerk_id = ${actor.userId},
          updated_by_name = ${await actorName(tx, actor)}
        WHERE id = ${id}
        RETURNING *`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'updated', entityType: 'payroll_runs',
            entityId: id, before: cur, after: rows[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Payroll run not found' });
      return json(res, 200, { data: rows[0] });
    }

    if (method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const existing = await sql`SELECT * FROM payroll_runs WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Payroll run not found' });
      if (requiresHigherApproval(actor, 'payroll')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'payroll', entityType: 'payroll_runs',
          entityId: id, operation: 'delete', requestedData: {}, before: existing[0],
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`DELETE FROM payroll_runs WHERE id = ${id} RETURNING id`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'deleted', entityType: 'payroll_runs',
            entityId: id, before: existing[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Payroll run not found' });
      return json(res, 200, { data: { id } });
    }

    res.setHeader('Allow', 'GET,POST,PUT,PATCH,DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(res, error);
  }
}
