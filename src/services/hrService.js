// API base for same-origin Vercel functions.

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = json?.error || json?.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.details = json?.details;
    throw err;
  }
  return json?.data !== undefined ? json.data : json;
}

export function createApiClient(getToken) {
  return {
    employees: {
      list: async (params = {}, token) => {
        const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
        return request(`/api/employees${q ? `?${q}` : ''}`, { token: token || (getToken ? await getToken() : null) });
      },
      get: async (id, token) => request(`/api/employees?id=${id}`, { token: token || (getToken ? await getToken() : null) }),
      create: async (data, token) => request('/api/employees', { method: 'POST', body: data, token: token || (getToken ? await getToken() : null) }),
      update: async (id, data, token) => request(`/api/employees?id=${id}`, { method: 'PATCH', body: data, token: token || (getToken ? await getToken() : null) }),
      remove: async (id, token) => request(`/api/employees?id=${id}`, { method: 'DELETE', token: token || (getToken ? await getToken() : null) }),
    },
    attendance: {
      list: async (params = {}, token) => {
        const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
        return request(`/api/attendance${q ? `?${q}` : ''}`, { token: token || (getToken ? await getToken() : null) });
      },
      create: async (data, token) => request('/api/attendance', { method: 'POST', body: data, token: token || (getToken ? await getToken() : null) }),
      bulkCreate: async (records, token) => request('/api/attendance', { method: 'POST', body: { bulk: true, records }, token: token || (getToken ? await getToken() : null) }),
      update: async (id, data, token) => request(`/api/attendance?id=${id}`, { method: 'PATCH', body: data, token: token || (getToken ? await getToken() : null) }),
      bulkUpdate: async (payload, token) => request('/api/attendance', { method: 'PATCH', body: { bulk: true, ...payload }, token: token || (getToken ? await getToken() : null) }),
      remove: async (id, token) => request(`/api/attendance?id=${id}`, { method: 'DELETE', token: token || (getToken ? await getToken() : null) }),
    },
    payroll: {
      list: async (params = {}, token) => {
        const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
        return request(`/api/payroll${q ? `?${q}` : ''}`, { token: token || (getToken ? await getToken() : null) });
      },
      create: async (data, token) => request('/api/payroll', { method: 'POST', body: data, token: token || (getToken ? await getToken() : null) }),
      update: async (id, data, token) => request(`/api/payroll?id=${id}`, { method: 'PATCH', body: data, token: token || (getToken ? await getToken() : null) }),
      remove: async (id, token) => request(`/api/payroll?id=${id}`, { method: 'DELETE', token: token || (getToken ? await getToken() : null) }),
    },
    approvals: {
      list: async (token) => request('/api/approvals', { token: token || (getToken ? await getToken() : null) }),
      submit: async (body, token) => request('/api/approvals', { method: 'POST', body, token: token || (getToken ? await getToken() : null) }),
      review: async (id, status, review_note = '', token) => request(`/api/approvals?id=${id}`, {
        method: 'PATCH',
        body: { status, review_note },
        token: token || (getToken ? await getToken() : null),
      }),
    },
    audit: {
      list: async (params = {}, token) => {
        const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
        return request(`/api/audit${q ? `?${q}` : ''}`, { token: token || (getToken ? await getToken() : null) });
      },
    },
    privileges: {
      listUsers: async (token) => request('/api/privileges', { token: token || (getToken ? await getToken() : null) }),
      setRole: async (targetUserId, role, token) => request('/api/privileges', { method: 'PATCH', body: { targetUserId, role }, token: token || (getToken ? await getToken() : null) }),
      linkEmployee: async (targetUserId, employeeId, token) => request('/api/privileges', {
        method: 'PATCH',
        body: { action: 'link-employee', targetUserId, employeeId },
        token: token || (getToken ? await getToken() : null),
      }),
    },
  };
}

// Local fallback for development without API/DB configured.
const LOCAL_KEY = 'agos-hr-local-v1';

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{"employees":[],"attendance":[],"payroll":[]}');
  } catch {
    return { employees: [], attendance: [], payroll: [] };
  }
}
function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}
function nextId(items) {
  return items.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
}

export const localHrStore = {
  employees: {
    async list(params = {}) {
      let items = readLocal().employees;
      if (params.employment_type) items = items.filter(i => i.employment_type === params.employment_type);
      if (params.status) items = items.filter(i => i.status === params.status);
      return items.sort((a, b) => (b.id || 0) - (a.id || 0));
    },
    async create(data) {
      const db = readLocal();
      const item = { ...data, id: nextId(db.employees), created_at: new Date().toISOString() };
      db.employees.push(item); writeLocal(db); return item;
    },
    async update(id, data) {
      const db = readLocal();
      const idx = db.employees.findIndex(e => String(e.id) === String(id));
      if (idx < 0) throw new Error('Employee not found');
      db.employees[idx] = { ...db.employees[idx], ...data, id: db.employees[idx].id };
      writeLocal(db); return db.employees[idx];
    },
    async remove(id) {
      const db = readLocal();
      db.employees = db.employees.filter(e => String(e.id) !== String(id));
      writeLocal(db); return { id };
    },
  },
    attendance: {
      async list(params = {}) {
        const db = readLocal();
        let items = db.attendance.map(a => ({ ...a, employee_name: db.employees.find(e => String(e.id) === String(a.employee_id))?.full_name || 'Unknown', pay_status: a.pay_status || 'unpaid', payment_date: a.payment_date || null, payment_notes: a.payment_notes || '' }));
        if (params.employee_id) items = items.filter(i => String(i.employee_id) === String(params.employee_id));
        if (params.status) items = items.filter(i => i.status === params.status);
        if (params.pay_status) items = items.filter(i => (i.pay_status || 'unpaid') === params.pay_status);
        if (params.date_from) {
          const from = new Date(params.date_from).getTime();
          items = items.filter(i => i.clock_in && new Date(i.clock_in).getTime() >= from);
        }
        if (params.date_to) {
          const to = new Date(params.date_to).getTime();
          items = items.filter(i => i.clock_in && new Date(i.clock_in).getTime() <= to);
        }
        if (params.payment_date_from) items = items.filter(i => i.payment_date && String(i.payment_date).slice(0, 10) >= String(params.payment_date_from).slice(0, 10));
        if (params.payment_date_to) items = items.filter(i => i.payment_date && String(i.payment_date).slice(0, 10) <= String(params.payment_date_to).slice(0, 10));
        items.sort((a, b) => String(b.clock_in || '').localeCompare(String(a.clock_in || '')));
        if (params.sort === 'asc') items.reverse();
        return items;
      },
      async create(data) {
        const db = readLocal();
        const total_hours = data.clock_out ? Number((((new Date(data.clock_out) - new Date(data.clock_in)) / 36e5) || 0).toFixed(2)) : null;
        const item = { ...data, id: nextId(db.attendance), total_hours, pay_status: data.pay_status || 'unpaid', payment_date: data.payment_date || null, payment_notes: data.payment_notes || '', created_at: new Date().toISOString() };
        db.attendance.push(item); writeLocal(db); return item;
      },
      async bulkCreate(records = []) {
        const created = []; const errors = [];
        for (let i = 0; i < records.length; i++) {
          const r = records[i] || {};
          if (!r.employee_id || !r.clock_in) { errors.push({ index: i, error: 'employee_id and clock_in required' }); continue; }
          try { created.push(await this.create(r)); } catch (e) { errors.push({ index: i, error: e.message }); }
        }
        return { created, errors, createdCount: created.length, errorCount: errors.length };
      },
      async update(id, data) {
        const db = readLocal();
        const idx = db.attendance.findIndex(e => String(e.id) === String(id));
        if (idx < 0) throw new Error('Attendance record not found');
        const merged = { ...db.attendance[idx], ...data, pay_status: data.pay_status ?? db.attendance[idx].pay_status ?? 'unpaid', payment_date: data.payment_date !== undefined ? (data.payment_date || null) : (db.attendance[idx].payment_date || null), payment_notes: data.payment_notes !== undefined ? (data.payment_notes || '') : (db.attendance[idx].payment_notes || '') };
        if (merged.clock_in && merged.clock_out) merged.total_hours = Number((((new Date(merged.clock_out) - new Date(merged.clock_in)) / 36e5) || 0).toFixed(2));
        db.attendance[idx] = merged; writeLocal(db); return merged;
      },
      async bulkUpdate(payload = {}) {
        const db = readLocal();
        const ids = new Set((payload.ids || []).map(String));
        const allowed = new Set(['unpaid', 'processing', 'paid']);
        if (!ids.size || !allowed.has(String(payload.pay_status))) throw new Error('ids and valid pay_status required');
        let updatedCount = 0;
        db.attendance = db.attendance.map(a => {
          if (!ids.has(String(a.id))) return a;
          updatedCount += 1;
          return { ...a, pay_status: payload.pay_status, ...(payload.payment_date ? { payment_date: payload.payment_date } : {}), ...(payload.payment_notes !== undefined ? { payment_notes: payload.payment_notes || '' } : {}) };
        });
        writeLocal(db);
        return { updatedCount };
      },
      async remove(id) {
        const db = readLocal();
        db.attendance = db.attendance.filter(e => String(e.id) !== String(id));
        writeLocal(db); return { id };
      },
    },
};
