import { getDb, withTransaction } from './_lib/db.js';
import { requireRole, json, handleApiError } from './_lib/auth.js';
import { ROLES } from './_lib/rbac.js';
import { actorName, resolveStoredNames, writeAudit } from './_lib/workflow.js';

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function handler(req, res) {
  try {
    const actor = await requireRole(req, ROLES.ADMIN);
    const sql = getDb();

    if (req.method === 'GET') {
      const employeeId = req.query?.employee_id ? parseId(req.query.employee_id) : null;
      if (req.query?.employee_id && !employeeId) {
        return json(res, 400, { error: 'A valid employee id is required.' });
      }
      const rows = employeeId
        ? await sql`
            SELECT p.*, e.full_name AS employee_name, r.pay_period_start, r.pay_period_end
            FROM employee_payments p
            JOIN employees e ON e.id = p.employee_id
            LEFT JOIN payroll_runs r ON r.id = p.payroll_run_id
            WHERE p.employee_id = ${employeeId}
            ORDER BY p.payment_date DESC, p.id DESC LIMIT 1000`
        : await sql`
            SELECT p.*, e.full_name AS employee_name, r.pay_period_start, r.pay_period_end
            FROM employee_payments p
            JOIN employees e ON e.id = p.employee_id
            LEFT JOIN payroll_runs r ON r.id = p.payroll_run_id
            ORDER BY p.payment_date DESC, p.id DESC LIMIT 1000`;
      return json(res, 200, { data: await resolveStoredNames(sql, rows) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const employeeId = parseId(body.employee_id);
      const payrollRunId = body.payroll_run_id ? parseId(body.payroll_run_id) : null;
      if (body.payroll_run_id && !payrollRunId) {
        return json(res, 400, { error: 'Select a valid payroll run.' });
      }
      const amount = Number(body.amount);
      const amountCents = Math.round(amount * 100);
      const paymentDate = body.payment_date;
      const paymentMethod = body.payment_method || 'other';
      const allowedMethods = ['cash', 'bank_transfer', 'mobile_money', 'check', 'other'];

      if (!employeeId) return json(res, 400, { error: 'Select a valid employee.' });
      if (!Number.isFinite(amount) || amountCents <= 0) {
        return json(res, 400, { error: 'Payment amount must be greater than zero.' });
      }
      if (!isDateOnly(paymentDate)) return json(res, 400, { error: 'Enter a valid payment date.' });
      if (!allowedMethods.includes(paymentMethod)) return json(res, 400, { error: 'Select a valid payment method.' });

      const employee = await sql`SELECT id FROM employees WHERE id = ${employeeId} LIMIT 1`;
      if (!employee[0]) return json(res, 404, { error: 'Employee not found.' });
      if (payrollRunId) {
        const run = await sql`
          SELECT id FROM payroll_runs
          WHERE id = ${payrollRunId} AND employee_id = ${employeeId} LIMIT 1`;
        if (!run[0]) return json(res, 400, { error: 'The selected payroll run does not belong to this employee.' });
      }

      const values = {
        employee_id: employeeId,
        payroll_run_id: payrollRunId,
        amount: amountCents / 100,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference: String(body.reference || '').trim() || null,
        notes: String(body.notes || '').trim() || null,
      };
      const rows = await withTransaction(async tx => {
        const created = await tx`
          INSERT INTO employee_payments (
            employee_id, payroll_run_id, amount, payment_date, payment_method,
            reference, notes, created_by_clerk_id, created_by_name
          )
          VALUES (
            ${values.employee_id}, ${values.payroll_run_id}, ${values.amount},
            ${values.payment_date}, ${values.payment_method}, ${values.reference},
            ${values.notes}, ${actor.userId}, ${await actorName(tx, actor)}
          )
          RETURNING *`;
        await writeAudit(tx, {
          actor,
          action: 'created',
          entityType: 'employee_payments',
          entityId: created[0].id,
          after: created[0],
        });
        return created;
      });
      return json(res, 201, { data: rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (!id) return json(res, 400, { error: 'A valid payment id is required.' });
      const existing = await sql`SELECT * FROM employee_payments WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Payment record not found.' });
      await withTransaction(async tx => {
        await tx`DELETE FROM employee_payments WHERE id = ${id}`;
        await writeAudit(tx, {
          actor,
          action: 'deleted',
          entityType: 'employee_payments',
          entityId: id,
          before: existing[0],
        });
      });
      return json(res, 200, { data: { id } });
    }

    res.setHeader('Allow', 'GET,POST,DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(res, error);
  }
}
