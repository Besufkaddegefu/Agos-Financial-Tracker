// Core app API client (customers, revenues, expenses) - mirrors hrService pattern
const jsonHeaders = (token) => {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};
async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(path, { method, headers: jsonHeaders(token), body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const d = data?.details && data.details !== data?.error ? `: ${data.details}` : ''; const e=new Error((data?.error || `Request failed (${res.status})`) + d); e.status=res.status; e.code=data?.code; throw e; }
  return data.data ?? data;
}
export function createCoreApiClient(getToken) {
  const gt = async (t) => t || (getToken ? await getToken() : null);
  const submitBulkDelete = async (entity_type, ids) => request('/api/approvals', {
    method: 'POST',
    body: { operation: 'bulk_delete', entity_type, ids },
    token: await gt(),
  });
  const crud = (base) => ({
    list: async (params={}, token) => { const q = new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString(); return request(`${base}${q?`?${q}`:''}`, { token: await gt(token) }); },
    get: async (id, token) => request(`${base}?id=${id}`, { token: await gt(token) }),
    create: async (data, token) => request(base, { method:'POST', body:data, token: await gt(token) }),
    update: async (id, data, token) => request(`${base}?id=${id}`, { method:'PATCH', body:data, token: await gt(token) }),
    remove: async (id, token) => request(`${base}?id=${id}`, { method:'DELETE', token: await gt(token) }),
  });
  return {
    customers: crud('/api/customers'),
    revenues: { ...crud('/api/revenues'), bulkDelete: ids => submitBulkDelete('revenues', ids) },
    expenses: { ...crud('/api/expenses'), bulkDelete: ids => submitBulkDelete('expenses', ids) },
  };
}
export async function checkDbHealth() {
  try { const r = await fetch('/api/health'); return await r.json(); } catch(e) { return { ok:false, error: e.message }; }
}
