import { getDb, withTransaction } from './_lib/db.js';
import { requireAuth, json, handleApiError } from './_lib/auth.js';
import { actorName, createApproval, resolveStoredNames, writeAudit } from './_lib/workflow.js';

function parseId(value) { const id = Number(value); return Number.isFinite(id) && id > 0 ? id : null; }
function toDate(v) { if (!v) return null; const s = String(v).slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function toNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
const STATUSES = new Set(['active','inactive','potential']);

export default async function handler(req, res) {
  try {
    const actor = await requireAuth(req);
    const sql = getDb();
    const { method } = req;

    if (method === 'GET') {
      const id = parseId(req.query?.id);
      if (id) {
        const rows = await sql`SELECT * FROM customers WHERE id = ${id} LIMIT 1`;
        if (!rows[0]) return json(res, 404, { error: 'Customer not found' });
        const [customer] = await resolveStoredNames(sql, rows);
        return json(res, 200, { data: customer });
      }
      const status = req.query?.status || null;
      const sort = req.query?.sort === 'asc' ? 'asc' : 'desc';
      const rows = sort === 'asc'
        ? await sql`SELECT * FROM customers WHERE (${status}::text IS NULL OR status::text = ${status}) ORDER BY acquisition_date ASC NULLS LAST, id ASC LIMIT 5000`
        : await sql`SELECT * FROM customers WHERE (${status}::text IS NULL OR status::text = ${status}) ORDER BY acquisition_date DESC NULLS LAST, id DESC LIMIT 5000`;
      return json(res, 200, { data: await resolveStoredNames(sql, rows) });
    }

    if (method === 'POST') {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      if (!name || !email) return json(res, 400, { error: 'name and email are required' });
      const status = STATUSES.has(String(b.status)) ? String(b.status) : 'potential';
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        INSERT INTO customers (name,email,phone,company,status,acquisition_date,total_value,last_purchase_date,created_by_clerk_id,created_by_name)
        VALUES (${name},${email},${b.phone||null},${b.company||null},${status},${toDate(b.acquisition_date)},${toNum(b.total_value,0)},${toDate(b.last_purchase_date)},${actor.userId||null},${await actorName(tx, actor)})
        RETURNING *`;
        await writeAudit(tx, {
          actor, action: 'created', entityType: 'customers',
          entityId: rows[0].id, after: rows[0],
        });
        return rows;
      });
      return json(res, 201, { data: rows[0] });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const id = parseId(req.query?.id || req.body?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      if (actor.role === 'employee') {
        return json(res, 403, { error: 'Employees may add customers. Ask an administrator to update an existing customer.' });
      }
      const b = req.body || {};
      const existing = await sql`SELECT * FROM customers WHERE id=${id} LIMIT 1`;
      if (!existing[0]) return json(res, 404, { error: 'Customer not found' });
      const cur = existing[0];
      const name = b.name !== undefined ? String(b.name||'').trim() : cur.name;
      const email = b.email !== undefined ? String(b.email||'').trim().toLowerCase() : cur.email;
      if (!name || !email) return json(res, 400, { error: 'name and email are required' });
      const status = b.status !== undefined ? (STATUSES.has(String(b.status)) ? String(b.status) : cur.status) : cur.status;
      const rows = await withTransaction(async tx => {
        const rows = await tx`
        UPDATE customers SET
          name=${name}, email=${email},
          phone=${b.phone !== undefined ? (b.phone||null) : cur.phone},
          company=${b.company !== undefined ? (b.company||null) : cur.company},
          status=${status},
          acquisition_date=${b.acquisition_date !== undefined ? toDate(b.acquisition_date) : cur.acquisition_date},
          total_value=${b.total_value !== undefined ? toNum(b.total_value,0) : cur.total_value},
          last_purchase_date=${b.last_purchase_date !== undefined ? toDate(b.last_purchase_date) : cur.last_purchase_date},
          updated_by_clerk_id=${actor.userId},
          updated_by_name=${await actorName(tx, actor)}
        WHERE id=${id} RETURNING *`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'updated', entityType: 'customers',
            entityId: id, before: cur, after: rows[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res,404,{error:'Customer not found'});
      return json(res, 200, { data: rows[0] });
    }

    if (method === 'DELETE') {
      const id = parseId(req.query?.id);
      if (!id) return json(res, 400, { error: 'Valid id required' });
      const existing = await sql`SELECT * FROM customers WHERE id=${id} LIMIT 1`;
      if (!existing[0]) return json(res,404,{error:'Customer not found'});
      if (actor.role === 'employee') {
        const approval = await withTransaction(tx => createApproval(tx, {
          actor, category: 'deletion', entityType: 'customers',
          entityId: id, operation: 'delete', requestedData: {},
          before: existing[0],
        }));
        return json(res, 202, { data: { pendingApproval: true, approvalId: approval.id } });
      }
      const rows = await withTransaction(async tx => {
        const rows = await tx`DELETE FROM customers WHERE id=${id} RETURNING id`;
        if (rows[0]) {
          await writeAudit(tx, {
            actor, action: 'deleted', entityType: 'customers',
            entityId: id, before: existing[0],
          });
        }
        return rows;
      });
      if (!rows[0]) return json(res,404,{error:'Customer not found'});
      return json(res, 200, { data: { id } });
    }

    res.setHeader('Allow','GET,POST,PUT,PATCH,DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) { return handleApiError(res, error); }
}
