import { getDb, withTransaction } from './_lib/db.js';
import { requireAuth, json, handleApiError } from './_lib/auth.js';
import { actorName, createApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';

const employeeFields = new Set([
  'full_name', 'email', 'phone', 'employment_type', 'salary_type',
  'base_rate', 'hire_date', 'status',
]);
const approvableEmployeeFields = new Set([...employeeFields, 'clerk_id']);
const attendanceFields = new Set([
  'employee_id', 'clock_in', 'clock_out', 'status', 'notes',
  'pay_status', 'payment_date', 'payment_notes',
]);

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function responseError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function submitOwnRequest(sql, actor, body) {
  if (actor.role !== 'employee') throw responseError(403, 'Self-service requests are available to employees only.');

  if (body.entity_type === 'employees') {
    throw responseError(403, 'Employee profile changes must be handled by an administrator, not submitted as personal requests.');
  }

  if (body.entity_type === 'attendance') {
    const employee = await sql`SELECT id FROM employees WHERE clerk_id = ${actor.userId} LIMIT 1`;
    if (!employee[0]) throw responseError(404, 'Your linked employee record was not found.');
    const operation = body.operation;
    if (!['create', 'update', 'delete'].includes(operation)) {
      throw responseError(400, 'Unsupported attendance request.');
    }
    if (operation === 'create') {
      throw responseError(400, 'Submit new attendance entries directly; use requests for corrections or removal.');
    }

    let entityId = null;
    let before = null;
    let data = body.requested_data || {};
    if (operation === 'create') {
      if (!data.clock_in) throw responseError(400, 'clock_in is required.');
      data = {
        employee_id: employee[0].id,
        clock_in: data.clock_in,
        clock_out: data.clock_out || null,
        status: data.status || 'present',
        notes: data.notes || null,
        pay_status: 'unpaid',
        payment_date: null,
        payment_notes: null,
      };
    } else {
      entityId = parseId(body.entity_id);
      if (!entityId) throw responseError(400, 'A valid attendance id is required.');
      const rows = await sql`
        SELECT * FROM attendance WHERE id = ${entityId} AND employee_id = ${employee[0].id} LIMIT 1`;
      if (!rows[0]) throw responseError(404, 'Your attendance record was not found.');
      before = rows[0];
      if (operation === 'update') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw responseError(400, 'requested_data must be an object.');
        }
        const keys = Object.keys(data);
        if (!keys.length || keys.some(key => !attendanceFields.has(key) || key === 'employee_id' || key.startsWith('pay_') || key.startsWith('payment_'))) {
          throw responseError(400, 'Only clock times, attendance status, and notes may be requested.');
        }
        const changedKeys = keys.filter(key => {
          if (data[key] === undefined) return false;
          if (['clock_in', 'clock_out'].includes(key)) {
            const requestedTime = data[key] ? new Date(data[key]).getTime() : null;
            const currentTime = before[key] ? new Date(before[key]).getTime() : null;
            return requestedTime !== currentTime;
          }
          return String(data[key] ?? '') !== String(before[key] ?? '');
        });
        data = Object.fromEntries(changedKeys.map(key => [key, data[key]]));
        if (!Object.keys(data).length) throw responseError(400, 'No attendance changes were requested.');
      } else {
        data = {};
      }
    }

    const approval = await createApproval(sql, {
      actor, category: 'attendance', entityType: 'attendance',
      entityId, operation, requestedData: data, before,
    });
    return { approvalId: approval.id };
  }

  throw responseError(400, 'Unsupported self-service request type.');
}

async function applyEmployeeChange(sql, request, actor) {
  const data = request.requested_data || {};
  const id = parseId(request.entity_id);
  if (request.operation === 'create') {
    const rows = await sql`
      INSERT INTO employees (
        clerk_id, full_name, email, phone, employment_type, salary_type, base_rate,
        hire_date, status, created_by_clerk_id, created_by_name,
        updated_by_clerk_id, updated_by_name
      )
      VALUES (
        ${data.clerk_id || null}, ${data.full_name}, ${String(data.email).toLowerCase()},
        ${data.phone || null}, ${data.employment_type || 'full_time'},
        ${data.salary_type || 'monthly_salary'}, ${Number(data.base_rate) || 0},
        ${data.hire_date}, ${data.status || 'active'},
        ${request.requested_by_clerk_id}, ${request.requested_by_name},
        ${actor.userId}, ${await actorName(sql, actor)}
      ) RETURNING *`;
    return { entityId: rows[0].id, before: null, after: rows[0], action: 'created' };
  }

  if (!id) throw responseError(400, 'The approval does not reference a valid employee.');
  if (request.operation === 'delete') {
    const rows = await sql`DELETE FROM employees WHERE id = ${id} RETURNING *`;
    if (!rows[0]) throw responseError(404, 'The employee no longer exists.');
    return { entityId: id, before: rows[0], after: null, action: 'deleted' };
  }

  const keys = Object.keys(data);
  if (!keys.length || keys.some(key => !approvableEmployeeFields.has(key))) {
    throw responseError(400, 'The approval contains unsupported employee fields.');
  }
  const rows = await sql`
    UPDATE employees SET
      clerk_id = CASE WHEN ${Object.hasOwn(data, 'clerk_id')} THEN ${data.clerk_id || null} ELSE clerk_id END,
      full_name = CASE WHEN ${Object.hasOwn(data, 'full_name')} THEN ${data.full_name ?? null} ELSE full_name END,
      email = CASE WHEN ${Object.hasOwn(data, 'email')} THEN ${data.email ? String(data.email).toLowerCase() : null} ELSE email END,
      phone = CASE WHEN ${Object.hasOwn(data, 'phone')} THEN ${data.phone || null} ELSE phone END,
      employment_type = CASE WHEN ${Object.hasOwn(data, 'employment_type')} THEN ${data.employment_type ?? null} ELSE employment_type END,
      salary_type = CASE WHEN ${Object.hasOwn(data, 'salary_type')} THEN ${data.salary_type ?? null} ELSE salary_type END,
      base_rate = CASE WHEN ${Object.hasOwn(data, 'base_rate')} THEN ${Number(data.base_rate)} ELSE base_rate END,
      hire_date = CASE WHEN ${Object.hasOwn(data, 'hire_date')} THEN ${data.hire_date ?? null} ELSE hire_date END,
      status = CASE WHEN ${Object.hasOwn(data, 'status')} THEN ${data.status ?? null} ELSE status END,
      updated_by_clerk_id = ${actor.userId},
      updated_by_name = ${await actorName(sql, actor)}
    WHERE id = ${id} RETURNING *`;
  if (!rows[0]) throw responseError(404, 'The employee no longer exists.');
  return { entityId: id, before: request.before_data, after: rows[0], action: 'updated' };
}

async function applyAttendanceChange(sql, request, actor) {
  const data = request.requested_data || {};
  const id = parseId(request.entity_id);
  if (request.operation === 'bulk_create') {
    const created = [];
    for (const record of data.records || []) {
      const rows = await sql`
        INSERT INTO attendance (
          employee_id, clock_in, clock_out, status, notes, pay_status, payment_date,
          payment_notes, created_by_clerk_id, created_by_name
        )
        VALUES (
          ${parseId(record.employee_id)}, ${record.clock_in}, ${record.clock_out || null},
          ${record.status || 'present'}, ${record.notes || null}, ${record.pay_status || 'unpaid'},
          ${record.payment_date || null}, ${record.payment_notes || null},
          ${request.requested_by_clerk_id}, ${request.requested_by_name}
        ) RETURNING *`;
      created.push(rows[0]);
    }
    return { entityId: null, before: null, after: created, action: 'bulk_created' };
  }

  if (request.operation === 'bulk_update') {
    const ids = (data.ids || []).map(parseId).filter(Boolean);
    if (!ids.length || ids.length > 500) throw responseError(400, 'The bulk request has no valid attendance ids.');
    const rows = await sql`
      UPDATE attendance SET
        pay_status = ${data.pay_status},
        payment_date = CASE WHEN ${data.payment_date ?? null}::date IS NULL THEN payment_date ELSE ${data.payment_date}::date END,
        payment_notes = CASE WHEN ${data.payment_notes ?? null}::text IS NULL THEN payment_notes ELSE ${data.payment_notes}::text END,
        updated_by_clerk_id = ${actor.userId},
        updated_by_name = ${await actorName(sql, actor)}
      WHERE id = ANY(${ids}::bigint[])
      RETURNING *`;
    return { entityId: null, before: null, after: rows, action: 'bulk_updated' };
  }

  if (!id && request.operation !== 'create') throw responseError(400, 'The approval does not reference a valid attendance record.');
  if (request.operation === 'create') {
    const rows = await sql`
      INSERT INTO attendance (
        employee_id, clock_in, clock_out, status, notes, pay_status, payment_date,
        payment_notes, created_by_clerk_id, created_by_name
      )
      VALUES (
        ${parseId(data.employee_id)}, ${data.clock_in}, ${data.clock_out || null},
        ${data.status || 'present'}, ${data.notes || null}, ${data.pay_status || 'unpaid'},
        ${data.payment_date || null}, ${data.payment_notes || null},
        ${request.requested_by_clerk_id}, ${request.requested_by_name}
      ) RETURNING *`;
    return { entityId: rows[0].id, before: null, after: rows[0], action: 'created' };
  }
  if (request.operation === 'delete') {
    const rows = await sql`DELETE FROM attendance WHERE id = ${id} RETURNING *`;
    if (!rows[0]) throw responseError(404, 'The attendance record no longer exists.');
    return { entityId: id, before: rows[0], after: null, action: 'deleted' };
  }

  const keys = Object.keys(data);
  if (!keys.length || keys.some(key => !attendanceFields.has(key))) {
    throw responseError(400, 'The approval contains unsupported attendance fields.');
  }
  const rows = await sql`
    UPDATE attendance SET
      employee_id = CASE WHEN ${Object.hasOwn(data, 'employee_id')} THEN ${parseId(data.employee_id)} ELSE employee_id END,
      clock_in = CASE WHEN ${Object.hasOwn(data, 'clock_in')} THEN ${data.clock_in ?? null} ELSE clock_in END,
      clock_out = CASE WHEN ${Object.hasOwn(data, 'clock_out')} THEN ${data.clock_out || null} ELSE clock_out END,
      status = CASE WHEN ${Object.hasOwn(data, 'status')} THEN ${data.status ?? null} ELSE status END,
      notes = CASE WHEN ${Object.hasOwn(data, 'notes')} THEN ${data.notes || null} ELSE notes END,
      pay_status = CASE WHEN ${Object.hasOwn(data, 'pay_status')} THEN ${data.pay_status ?? null} ELSE pay_status END,
      payment_date = CASE WHEN ${Object.hasOwn(data, 'payment_date')} THEN ${data.payment_date || null} ELSE payment_date END,
      payment_notes = CASE WHEN ${Object.hasOwn(data, 'payment_notes')} THEN ${data.payment_notes || null} ELSE payment_notes END,
      updated_by_clerk_id = ${actor.userId},
      updated_by_name = ${await actorName(sql, actor)}
    WHERE id = ${id} RETURNING *`;
  if (!rows[0]) throw responseError(404, 'The attendance record no longer exists.');
  return { entityId: id, before: request.before_data, after: rows[0], action: 'updated' };
}

async function applyPayrollChange(sql, request, actor) {
  const data = request.requested_data || {};
  const id = parseId(request.entity_id);
  if (request.operation === 'create') {
    const gross = Number(data.gross_pay) || 0;
    const deductions = Number(data.deductions) || 0;
    const rows = await sql`
      INSERT INTO payroll_runs (
        employee_id, pay_period_start, pay_period_end, total_units, gross_pay,
        deductions, net_pay, status, created_by_clerk_id, created_by_name
      )
      VALUES (
        ${parseId(data.employee_id)}, ${data.pay_period_start}, ${data.pay_period_end},
        ${Number(data.total_units) || 0}, ${gross}, ${deductions},
        ${data.net_pay == null ? gross - deductions : Number(data.net_pay)},
        ${data.status || 'draft'}, ${request.requested_by_clerk_id}, ${request.requested_by_name}
      ) RETURNING *`;
    return { entityId: rows[0].id, before: null, after: rows[0], action: 'created' };
  }
  if (!id) throw responseError(400, 'The approval does not reference a valid payroll record.');
  if (request.operation === 'delete') {
    const rows = await sql`DELETE FROM payroll_runs WHERE id = ${id} RETURNING *`;
    if (!rows[0]) throw responseError(404, 'The payroll record no longer exists.');
    return { entityId: id, before: rows[0], after: null, action: 'deleted' };
  }
  const rows = await sql`
    UPDATE payroll_runs SET
      total_units = CASE WHEN ${Object.hasOwn(data, 'total_units')} THEN ${Number(data.total_units)} ELSE total_units END,
      gross_pay = CASE WHEN ${Object.hasOwn(data, 'gross_pay')} THEN ${Number(data.gross_pay)} ELSE gross_pay END,
      deductions = CASE WHEN ${Object.hasOwn(data, 'deductions')} THEN ${Number(data.deductions)} ELSE deductions END,
      net_pay = CASE WHEN ${Object.hasOwn(data, 'net_pay')} THEN ${Number(data.net_pay)} ELSE net_pay END,
      status = CASE WHEN ${Object.hasOwn(data, 'status')} THEN ${data.status ?? null} ELSE status END,
      updated_by_clerk_id = ${actor.userId},
      updated_by_name = ${await actorName(sql, actor)}
    WHERE id = ${id} RETURNING *`;
  if (!rows[0]) throw responseError(404, 'The payroll record no longer exists.');
  return { entityId: id, before: request.before_data, after: rows[0], action: 'updated' };
}

async function applyBulkDelete(sql, request) {
  const ids = (request.requested_data?.ids || []).map(parseId).filter(Boolean);
  if (!ids.length || ids.length > 500) throw responseError(400, 'The bulk request has no valid record ids.');
  const rows = request.entity_type === 'revenues'
    ? await sql`DELETE FROM revenues WHERE id = ANY(${ids}::bigint[]) RETURNING *`
    : request.entity_type === 'expenses'
      ? await sql`DELETE FROM expenses WHERE id = ANY(${ids}::bigint[]) RETURNING *`
      : null;
  if (!rows) throw responseError(400, 'Bulk deletion is not supported for this record type.');
  return { entityId: null, before: rows, after: null, action: 'bulk_deleted' };
}

async function applyCustomerChange(sql, request) {
  const id = parseId(request.entity_id);
  if (request.operation !== 'delete' || !id) {
    throw responseError(400, 'The approval does not reference a valid customer deletion.');
  }
  const rows = await sql`DELETE FROM customers WHERE id = ${id} RETURNING *`;
  if (!rows[0]) throw responseError(404, 'The customer no longer exists.');
  return { entityId: id, before: rows[0], after: null, action: 'deleted' };
}

async function applyFinancialChange(sql, request, actor) {
  const id = parseId(request.entity_id);
  if (!id) throw responseError(400, 'The approval does not reference a valid transaction.');

  if (request.operation === 'delete') {
    const rows = request.entity_type === 'revenues'
      ? await sql`DELETE FROM revenues WHERE id = ${id} RETURNING *`
      : await sql`DELETE FROM expenses WHERE id = ${id} RETURNING *`;
    if (!rows[0]) throw responseError(404, 'The transaction no longer exists.');
    return { entityId: id, before: rows[0], after: null, action: 'deleted' };
  }

  if (request.operation !== 'update' || !Object.hasOwn(request.requested_data || {}, 'amount')) {
    throw responseError(400, 'The approval does not contain a valid transaction amount change.');
  }
  const data = request.requested_data;
  const amount = Number(data.amount);
  if (!Number.isFinite(amount)) throw responseError(400, 'The requested amount is invalid.');
  const rows = request.entity_type === 'revenues'
    ? await sql`
        UPDATE revenues SET
          amount = ${amount},
          source = CASE WHEN ${Object.hasOwn(data, 'source')} THEN ${data.source ?? null} ELSE source END,
          category = CASE WHEN ${Object.hasOwn(data, 'category')} THEN ${data.category ?? null} ELSE category END,
          date = CASE WHEN ${Object.hasOwn(data, 'date')} THEN ${data.date ?? null}::date ELSE date END,
          customer_name = CASE WHEN ${Object.hasOwn(data, 'customer_name')} THEN ${data.customer_name ?? null} ELSE customer_name END,
          customer_id = CASE WHEN ${Object.hasOwn(data, 'customer_id')} THEN ${parseId(data.customer_id)} ELSE customer_id END,
          description = CASE WHEN ${Object.hasOwn(data, 'description')} THEN ${data.description ?? null} ELSE description END,
          updated_by_clerk_id = ${actor.userId},
          updated_by_name = ${await actorName(sql, actor)}
        WHERE id = ${id} RETURNING *`
    : await sql`
        UPDATE expenses SET
          amount = ${amount},
          category = CASE WHEN ${Object.hasOwn(data, 'category')} THEN ${data.category ?? null} ELSE category END,
          vendor = CASE WHEN ${Object.hasOwn(data, 'vendor')} THEN ${data.vendor ?? null} ELSE vendor END,
          date = CASE WHEN ${Object.hasOwn(data, 'date')} THEN ${data.date ?? null}::date ELSE date END,
          description = CASE WHEN ${Object.hasOwn(data, 'description')} THEN ${data.description ?? null} ELSE description END,
          receipt_url = CASE WHEN ${Object.hasOwn(data, 'receipt_url')} THEN ${data.receipt_url ?? null} ELSE receipt_url END,
          updated_by_clerk_id = ${actor.userId},
          updated_by_name = ${await actorName(sql, actor)}
        WHERE id = ${id} RETURNING *`;
  if (!rows[0]) throw responseError(404, 'The transaction no longer exists.');
  return { entityId: id, before: request.before_data, after: rows[0], action: 'updated' };
}

async function applyApproval(sql, request, actor) {
  switch (request.entity_type) {
    case 'employees': return applyEmployeeChange(sql, request, actor);
    case 'attendance': return applyAttendanceChange(sql, request, actor);
    case 'payroll_runs': return applyPayrollChange(sql, request, actor);
    case 'customers': return applyCustomerChange(sql, request);
    case 'revenues':
    case 'expenses':
      return request.operation === 'bulk_delete'
        ? applyBulkDelete(sql, request)
        : applyFinancialChange(sql, request, actor);
    default: throw responseError(400, 'Unsupported approval record type.');
  }
}

export default async function handler(req, res) {
  try {
    const actor = await requireAuth(req);
    const sql = getDb();

    if (req.method === 'GET') {
      const canViewApprovalHistory = ['admin', 'owner'].includes(actor.role);
      const rows = await sql`
        SELECT * FROM change_approvals
        WHERE ${canViewApprovalHistory}
           OR (${actor.role === 'employee'} AND requested_by_clerk_id = ${actor.userId})
        ORDER BY created_at DESC LIMIT 500`;
      return json(res, 200, {
        data: await resolveStoredNames(sql, rows),
        viewerRole: actor.role,
      });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.operation === 'bulk_delete') {
        const entityType = body.entity_type;
        if (!['revenues', 'expenses'].includes(entityType)) {
          throw responseError(400, 'Bulk deletion is only supported for revenues or expenses.');
        }
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(parseId).filter(Boolean))];
        if (!ids.length || ids.length > 500) throw responseError(400, 'Select between 1 and 500 records.');
        const requestedData = { ids };
        if (actor.role === 'employee') {
          const approval = await withTransaction(tx => createApproval(tx, {
            actor, category: 'bulk', entityType, operation: 'bulk_delete', requestedData,
          }));
          return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
        }
        const deleted = await withTransaction(async tx => {
          const rows = entityType === 'revenues'
            ? await tx`DELETE FROM revenues WHERE id = ANY(${ids}::bigint[]) RETURNING *`
            : await tx`DELETE FROM expenses WHERE id = ANY(${ids}::bigint[]) RETURNING *`;
          await writeAudit(tx, {
            actor, action: 'bulk_deleted', entityType, before: rows,
            metadata: { ids, count: rows.length },
          });
          return rows;
        });
        return json(res, 200, { data: { deletedCount: deleted.length } });
      }

      const submitted = await withTransaction(tx => submitOwnRequest(tx, actor, body));
      return json(res, 201, { data: { pendingApproval: true, ...submitted } });
    }

    if (req.method === 'PATCH') {
      const canReviewEmployeeRequests = ['admin', 'owner'].includes(actor.role);
      const id = parseId(req.query?.id || req.body?.id);
      const decision = req.body?.status;
      if (!id || !['approved', 'rejected'].includes(decision)) {
        return json(res, 400, { error: 'A valid request id and approved/rejected status are required.' });
      }

      const result = await withTransaction(async tx => {
        const claimed = await tx`
          UPDATE change_approvals
          SET status = 'processing'
          WHERE id = ${id} AND status = 'pending'
            AND requested_by_clerk_id <> ${actor.userId}
            AND requested_by_role = 'employee'
            AND ${canReviewEmployeeRequests}
          RETURNING *`;
        if (!claimed[0]) throw responseError(409, 'Request is not pending or you are not allowed to review it.');
        const request = claimed[0];
        const applied = decision === 'approved'
          ? await applyApproval(tx, request, actor)
          : null;

        if (applied) {
          await writeAudit(tx, {
            actor,
            action: applied.action,
            entityType: request.entity_type,
            entityId: applied.entityId,
            before: applied.before,
            after: applied.after,
            metadata: { approvalId: request.id, requestedBy: request.requested_by_clerk_id },
          });
        }
        const updated = await tx`
          UPDATE change_approvals
          SET status = ${decision}, reviewed_by_clerk_id = ${actor.userId},
              reviewed_by_name = ${await actorName(tx, actor)},
              reviewed_by_role = ${actor.role}, review_note = ${req.body?.review_note || null},
              reviewed_at = NOW()
          WHERE id = ${id} AND status = 'processing'
          RETURNING *`;
        await writeAudit(tx, {
          actor,
          action: `approval_${decision}`,
          entityType: 'change_approvals',
          entityId: id,
          before: request,
          after: updated[0],
        });
        return updated[0];
      });

      return json(res, 200, { data: await resolveStoredNames(sql, [result]).then(rows => rows[0]) });
    }

    res.setHeader('Allow', 'GET,POST,PATCH');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return handleApiError(res, error);
  }
}
