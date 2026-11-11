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
    const actor = isSelfService || req.method === 'POST'
      ? await requireAuth(req)
      : await requireRole(req, ROLES.ADMIN);
    const sql = getDb();
    const { method } = req;
    const displayName = method === 'GET' ? null : await actorName(sql, actor);

    if (method === 'GET') {
      const id = parseId(req.query?.id);
      if (isSelfService) {
        const employee = await sql`SELECT id FROM employees WHERE clerk_id = ${actor.userId} LIMIT 1`;
        if (!employee[0]) return json(res, 200, { data: [] });
        const rows = await sql`
          SELECT a.*, e.full_name AS employee_name
          FROM attendance a JOIN employees e ON e.id = a.employee_id
          WHERE a.employee_id = ${employee[0].id}
          ORDER BY a.clock_in DESC LIMIT 1000`;
        return json(res, 200, { data: await resolveStoredNames(sql, rows) });
      }
      if (id) {
        const rows = await sql`SELECT * FROM attendance WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return json(res, 404, { error: 'Attendance record not found' });
        const [record] = await resolveStoredNames(sql, rows);
        return json(res, 200, { data: record });
      }
      const employeeId = parseId(req.query?.employee_id);
      const status = req.query?.status || null;
      const payStatus = req.query?.pay_status || null;
      const dateFrom = req.query?.date_from || null;
      const dateTo = req.query?.date_to || null;
      const paymentDateFrom = req.query?.payment_date_from || null;
      const paymentDateTo = req.query?.payment_date_to || null;
      const asc = req.query?.sort === 'asc';
      const rows = asc
        ? await sql`
            SELECT a.*, e.full_name AS employee_name
            FROM attendance a
            JOIN employees e ON e.id = a.employee_id
            WHERE (${employeeId}::bigint IS NULL OR a.employee_id = ${employeeId})
              AND (${status}::text IS NULL OR a.status::text = ${status})
              AND (${payStatus}::text IS NULL OR a.pay_status::text = ${payStatus})
              AND (${dateFrom}::timestamptz IS NULL OR a.clock_in >= ${dateFrom}::timestamptz)
              AND (${dateTo}::timestamptz IS NULL OR a.clock_in <= ${dateTo}::timestamptz)
              AND (${paymentDateFrom}::date IS NULL OR a.payment_date >= ${paymentDateFrom}::date)
              AND (${paymentDateTo}::date IS NULL OR a.payment_date <= ${paymentDateTo}::date)
            ORDER BY a.clock_in ASC LIMIT 1000`
        : await sql`
            SELECT a.*, e.full_name AS employee_name
            FROM attendance a
            JOIN employees e ON e.id = a.employee_id
            WHERE (${employeeId}::bigint IS NULL OR a.employee_id = ${employeeId})
              AND (${status}::text IS NULL OR a.status::text = ${status})
              AND (${payStatus}::text IS NULL OR a.pay_status::text = ${payStatus})
              AND (${dateFrom}::timestamptz IS NULL OR a.clock_in >= ${dateFrom}::timestamptz)
              AND (${dateTo}::timestamptz IS NULL OR a.clock_in <= ${dateTo}::timestamptz)
              AND (${paymentDateFrom}::date IS NULL OR a.payment_date >= ${paymentDateFrom}::date)
              AND (${paymentDateTo}::date IS NULL OR a.payment_date <= ${paymentDateTo}::date)
            ORDER BY a.clock_in DESC LIMIT 1000`;
      return json(res, 200, { data: await resolveStoredNames(sql, rows) });
    }

    if (method === 'POST') {
      const b = req.body || {};
      if (actor.role === 'employee') {
        const allowedFields = new Set(['employee_id', 'clock_in', 'clock_out', 'status', 'notes']);
        if (Object.keys(b).some(key => !allowedFields.has(key))) {
          return json(res, 400, { error: 'Employees may only submit their own clock times, status, and notes.' });
        }
        const ownEmployee = await sql`SELECT id FROM employees WHERE clerk_id = ${actor.userId} LIMIT 1`;
        if (!ownEmployee[0]) return json(res, 404, { error: 'Your linked employee record was not found.' });
        const requestedEmployeeId = b.employee_id == null ? ownEmployee[0].id : parseId(b.employee_id);
        if (requestedEmployeeId !== Number(ownEmployee[0].id)) {
          return json(res, 403, { error: 'You may only submit your own attendance.' });
        }
        if (!b.clock_in || Number.isNaN(new Date(b.clock_in).getTime())) {
          return json(res, 400, { error: 'A valid clock-in time is required.' });
        }
        const rows = await withTransaction(async tx => {
          const rows = await tx`
            INSERT INTO attendance (
              employee_id, clock_in, clock_out, status, notes, pay_status,
              created_by_clerk_id, created_by_name
            )
            VALUES (
              ${ownEmployee[0].id}, ${b.clock_in}, ${b.clock_out || null},
              ${b.status || 'present'}, ${b.notes || null}, 'unpaid',
              ${actor.userId}, ${displayName}
            )
            RETURNING *`;
          await writeAudit(tx, {
            actor, action: 'created', entityType: 'attendance',
            entityId: rows[0].id, after: rows[0],
          });
          return rows;
        });
        return json(res, 201, { data: rows[0] });
      }

      // Bulk create: { bulk: true, records: [...] }
      if (b.bulk && Array.isArray(b.records)) {
        if (b.records.length === 0 || b.records.length > 200) return json(res, 400, { error: 'records must contain 1-200 items' });
        if (requiresHigherApproval(actor, 'bulk')) {
          const approval = await withTransaction(tx => createApproval(tx, {
            actor, category: 'bulk', entityType: 'attendance',
            operation: 'bulk_create', requestedData: { records: b.records },
          }));
          return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
        }
        const created = [];
        const errors = [];
        for (let i = 0; i < b.records.length; i++) {
          const r = b.records[i] || {};
          const employeeId = parseId(r.employee_id);
          if (!employeeId || !r.clock_in) { errors.push({ index: i, error: 'employee_id and clock_in required' }); continue; }
          try {
            const rows = await withTransaction(async tx => {
              const rows = await tx`
              INSERT INTO attendance (
                employee_id, clock_in, clock_out, status, notes, pay_status,
                payment_date, payment_notes, created_by_clerk_id, created_by_name
              )
              VALUES (
                ${employeeId}, ${r.clock_in}, ${r.clock_out || null},
                ${r.status || 'present'}, ${r.notes || null}, ${r.pay_status || 'unpaid'},
                ${r.payment_date || null}, ${r.payment_notes || null},
                ${actor.userId}, ${displayName}
              )
              RETURNING *`;
              await writeAudit(tx, {
                actor, action: 'created', entityType: 'attendance',
                entityId: rows[0].id, after: rows[0],
              });
              return rows;
            });
            created.push(rows[0]);
          } catch (err) {
            errors.push({ index: i, employee_id: employeeId, error: err?.message || 'Insert failed' });
          }
        }
        return json(res, 201, { data: { created, errors, createdCount: created.length, errorCount: errors.length } });
      }

      const employeeId = parseId(b.employee_id);
      if (!employeeId || !b.clock_in) return json(res, 400, { error: 'employee_id and clock_in are required' });
      const data = {
        employee_id: employeeId, clock_in: b.clock_in, clock_out: b.clock_out || null,
        status: b.status || 'present', notes: b.notes || null,
        pay_status: b.pay_status || 'unpaid', payment_date: b.payment_date || null,
        payment_notes: b.payment_notes || null,
      };
      if (requiresHigherApproval(actor, 'attendance')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'attendance', entityType: 'attendance',
          operation: 'create', requestedData: data,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        INSERT INTO attendance (
          employee_id, clock_in, clock_out, status, notes, pay_status, payment_date,
          payment_notes, created_by_clerk_id, created_by_name
        )
        VALUES (
          ${employeeId}, ${b.clock_in}, ${b.clock_out || null}, ${b.status || 'present'},
          ${b.notes || null}, ${b.pay_status || 'unpaid'}, ${b.payment_date || null},
          ${b.payment_notes || null}, ${actor.userId}, ${displayName}
        )
        RETURNING *`;
        await writeAudit(tx, {
          actor, action: 'created', entityType: 'attendance',
          entityId: rows[0].id, after: rows[0],
        });
        return rows;
      });
      return json(res, 201, { data: rows[0] });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const b = req.body || {};
      // Bulk pay/status update: { bulk: true, ids: [1,2], pay_status: 'paid', payment_date?, payment_notes? } (admin+)
      if (b.bulk && Array.isArray(b.ids) && b.pay_status) {
        const ids = b.ids.map(parseId).filter(Boolean);
        if (!ids.length || ids.length > 500) return json(res, 400, { error: 'ids must contain 1-500 valid items' });
        const allowed = new Set(['unpaid', 'processing', 'paid']);
        if (!allowed.has(String(b.pay_status))) return json(res, 400, { error: 'Invalid pay_status' });
        if (requiresHigherApproval(actor, 'bulk')) {
          const approval = await withTransaction(tx => createApproval(tx, {
            actor, category: 'bulk', entityType: 'attendance',
            operation: 'bulk_update', requestedData: {
              ids, pay_status: b.pay_status, payment_date: b.payment_date,
              payment_notes: b.payment_notes,
            },
          }));
          return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
        }
        const paymentDate = b.payment_date === '' ? null : (b.payment_date ?? null);
        const paymentNotes = b.payment_notes === '' ? null : (b.payment_notes ?? null);
        const rows = await withTransaction(async tx => {
          const rows = await tx`
          UPDATE attendance SET
            pay_status = ${b.pay_status},
            payment_date = CASE WHEN ${paymentDate}::date IS NULL THEN payment_date ELSE ${paymentDate}::date END,
            payment_notes = CASE WHEN ${paymentNotes}::text IS NULL THEN payment_notes ELSE ${paymentNotes}::text END,
            updated_by_clerk_id = ${actor.userId},
            updated_by_name = ${displayName}
          WHERE id = ANY(${ids}::bigint[])
          RETURNING id, employee_id, clock_in, pay_status, payment_date, payment_notes`;
          await writeAudit(tx, {
            actor, action: 'bulk_updated', entityType: 'attendance',
            metadata: { ids, after: rows },
          });
          return rows;
        });
        return json(res, 200, { data: { updated: rows, updatedCount: rows.length } });
      }

      const id = parseId(req.query?.id || b.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const existing = await sql`SELECT * FROM attendance WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Attendance record not found' });
      const cur = existing[0];
      const changes = {
        employee_id: b.employee_id != null ? parseId(b.employee_id) : cur.employee_id,
        clock_in: b.clock_in ?? cur.clock_in,
        clock_out: b.clock_out !== undefined ? b.clock_out || null : cur.clock_out,
        status: b.status ?? cur.status,
        pay_status: b.pay_status ?? cur.pay_status,
        payment_date: b.payment_date !== undefined ? b.payment_date || null : cur.payment_date,
        payment_notes: b.payment_notes !== undefined ? b.payment_notes || null : cur.payment_notes,
        notes: b.notes !== undefined ? b.notes || null : cur.notes,
      };
      const paymentChanged = ['pay_status', 'payment_date', 'payment_notes']
        .some(key => String(changes[key] ?? '') !== String(cur[key] ?? ''));
      const category = paymentChanged ? 'payroll' : 'attendance';
      if (requiresHigherApproval(actor, category)) {
        const requestedData = Object.fromEntries(
          Object.entries(changes).filter(([key, value]) => String(value ?? '') !== String(cur[key] ?? ''))
        );
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category, entityType: 'attendance', entityId: id,
          operation: 'update', requestedData, before: cur,
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        UPDATE attendance SET
          employee_id = ${changes.employee_id},
          clock_in = ${changes.clock_in},
          clock_out = ${changes.clock_out},
          status = ${changes.status},
          pay_status = ${changes.pay_status},
          payment_date = ${changes.payment_date},
          payment_notes = ${changes.payment_notes},
          notes = ${changes.notes},
          updated_by_clerk_id = ${actor.userId},
          updated_by_name = ${displayName}
        WHERE id = ${id}
        RETURNING *`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'updated', entityType: 'attendance', entityId: id,
            before: cur, after: rows[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Attendance record not found' });
      return json(res, 200, { data: rows[0] });
    }

    if (method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const existing = await sql`SELECT * FROM attendance WHERE id = ${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Attendance record not found' });
      if (requiresHigherApproval(actor, 'attendance')) {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'attendance', entityType: 'attendance',
          entityId: id, operation: 'delete', requestedData: {},
          before: existing[0],
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`DELETE FROM attendance WHERE id = ${id} RETURNING id`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'deleted', entityType: 'attendance', entityId: id,
            before: existing[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res, 404, { error: 'Attendance record not found' });
      return json(res, 200, { data: { id } });
    }

    res.setHeader('Allow', 'GET,POST,PUT,PATCH,DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(res, error);
  }
}
