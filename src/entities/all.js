// Entity classes: DB-backed when Clerk+API available, else localStorage dataStore fallback.
import dataStore from '../store/dataStore.js';
import { createCoreApiClient } from '../services/appApi.js';

const delay = (ms = 200) => new Promise(r => setTimeout(r, ms));
let _getToken = null;
let _dbEnabled = false;
let _client = null;

export function configureEntityDataSource({ getToken, dbEnabled } = {}) {
  _getToken = typeof getToken === 'function' ? getToken : null;
  _dbEnabled = Boolean(dbEnabled && _getToken);
  _client = _dbEnabled ? createCoreApiClient(_getToken) : null;
}
export function isDbBacked() { return _dbEnabled && !!_client; }

async function maybeDb(op, fallback, { allowUnavailableFallback = true } = {}) {
  if (_dbEnabled && _client) {
    try {
      return await op(_client);
    } catch (e) {
      // Only use local data when the API route is unavailable; real server errors must stay visible.
      const status = e?.status;
      const msg = String(e?.message || '');
      const apiUnavailable = status === 404 || /Failed to fetch|NetworkError|Request failed \(404\)/i.test(msg);
      if (!apiUnavailable || !allowUnavailableFallback) throw e;
      console.warn('[entities] DB op failed; using local fallback:', msg);
      // Attach a hint once for callers that care
      try { if (!window.__dbFallbackWarned) { window.__dbFallbackWarned = true; console.info('DB unavailable; showing local data. Start API (vercel dev) for Neon-backed data.'); } } catch {}
      return fallback();
    }
  }
  return fallback();
}

function toClientCustomer(r) {
  if (!r) return r;
  return { ...r, id: r.id, acquisition_date: r.acquisition_date ? String(r.acquisition_date).slice(0,10) : r.acquisition_date, last_purchase_date: r.last_purchase_date ? String(r.last_purchase_date).slice(0,10) : r.last_purchase_date, total_value: Number(r.total_value ?? 0) };
}
function toClientMoney(r) {
  if (!r) return r;
  return { ...r, date: r.date ? String(r.date).slice(0,10) : r.date, amount: Number(r.amount ?? 0) };
}

export class Revenue {
  static async list(sortBy = '-date') {
    return maybeDb(
      async (c) => (await c.revenues.list({ sort: sortBy.startsWith('-') ? 'desc' : 'asc' })).map(toClientMoney),
      async () => { await delay(); return dataStore.getRevenues(sortBy); }
    );
  }
  static async get(id) { return maybeDb(async c => toClientMoney(await c.revenues.get(id)), async () => { await delay(150); return dataStore.getRevenues().find(r => String(r.id) === String(id)); }); }
  static async create(data) { return maybeDb(async c => toClientMoney(await c.revenues.create(data)), async () => { await delay(150); return dataStore.addRevenue(data); }, { allowUnavailableFallback: false }); }
  static async update(id, data) { return maybeDb(async c => toClientMoney(await c.revenues.update(id, data)), async () => { await delay(150); return dataStore.updateRevenue(id, data); }, { allowUnavailableFallback: false }); }
  static async delete(id) { return maybeDb(async c => c.revenues.remove(id), async () => { await delay(150); return dataStore.deleteRevenue(id); }, { allowUnavailableFallback: false }); }
  static async bulkDelete(ids) {
    if (isDbBacked()) return _client.revenues.bulkDelete(ids);
    await delay(150);
    for (const id of ids) dataStore.deleteRevenue(id);
    return { deletedCount: ids.length };
  }
}

export class Expense {
  static async list(sortBy = '-date') {
    return maybeDb(
      async (c) => (await c.expenses.list({ sort: sortBy.startsWith('-') ? 'desc' : 'asc' })).map(toClientMoney),
      async () => { await delay(); return dataStore.getExpenses(sortBy); }
    );
  }
  static async get(id) { return maybeDb(async c => toClientMoney(await c.expenses.get(id)), async () => { await delay(150); return dataStore.getExpenses().find(e => String(e.id) === String(id)); }); }
  static async create(data) { return maybeDb(async c => toClientMoney(await c.expenses.create(data)), async () => { await delay(150); return dataStore.addExpense(data); }, { allowUnavailableFallback: false }); }
  static async update(id, data) { return maybeDb(async c => toClientMoney(await c.expenses.update(id, data)), async () => { await delay(150); return dataStore.updateExpense(id, data); }, { allowUnavailableFallback: false }); }
  static async delete(id) { return maybeDb(async c => c.expenses.remove(id), async () => { await delay(150); return dataStore.deleteExpense(id); }, { allowUnavailableFallback: false }); }
  static async bulkDelete(ids) {
    if (isDbBacked()) return _client.expenses.bulkDelete(ids);
    await delay(150);
    for (const id of ids) dataStore.deleteExpense(id);
    return { deletedCount: ids.length };
  }
}

export class Customer {
  static async list(sortBy = '-acquisition_date') {
    return maybeDb(
      async (c) => (await c.customers.list({ sort: sortBy.startsWith('-') ? 'desc' : 'asc' })).map(toClientCustomer),
      async () => { await delay(); return dataStore.getCustomers(sortBy); }
    );
  }
  static async get(id) { return maybeDb(async c => toClientCustomer(await c.customers.get(id)), async () => { await delay(150); return dataStore.getCustomer(id); }); }
  static async create(data) { return maybeDb(async c => toClientCustomer(await c.customers.create(data)), async () => { await delay(150); return dataStore.addCustomer(data); }, { allowUnavailableFallback: false }); }
  static async update(id, data) { return maybeDb(async c => toClientCustomer(await c.customers.update(id, data)), async () => { await delay(150); return dataStore.updateCustomer(id, data); }, { allowUnavailableFallback: false }); }
  static async delete(id) { return maybeDb(async c => c.customers.remove(id), async () => { await delay(150); return dataStore.deleteCustomer(id); }, { allowUnavailableFallback: false }); }
}

export class Analytics {
  static async getAnalytics(dateRange = null) {
    // Compute from entities (works in both modes)
    const [revenues, expenses, customers] = await Promise.all([Revenue.list('-date'), Expense.list('-date'), Customer.list('-acquisition_date')]);
    // Minimal analytics compatible with existing callers; if localStore has richer method, use it in local mode
    if (!isDbBacked() && dataStore.getAnalytics) { try { return await (async()=>{ await delay(); return dataStore.getAnalytics(dateRange); })(); } catch(_){} }
    const inRange = (d) => { if (!dateRange?.from || !dateRange?.to) return true; const t = new Date(d).getTime(); return t >= new Date(dateRange.from).getTime() && t <= new Date(dateRange.to).getTime()+86400000; };
    const rev = revenues.filter(r=>inRange(r.date)); const exp = expenses.filter(e=>inRange(e.date));
    const totalRevenue = rev.reduce((s,r)=>s+Number(r.amount||0),0);
    const totalExpenses = exp.reduce((s,e)=>s+Number(e.amount||0),0);
    const netProfit = totalRevenue - totalExpenses;
    const activeCustomers = customers.filter(c=>c.status==='active').length;
    return { totalRevenue, totalExpenses, netProfit, activeCustomers, revenueCount: rev.length, expenseCount: exp.length, customerCount: customers.length, revenues: rev, expenses: exp, customers };
  }
}
