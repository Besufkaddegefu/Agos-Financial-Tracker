import { getDb } from './_lib/db.js';
import { json } from './_lib/auth.js';
export default async function handler(req, res) {
  const hasDb = Boolean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL);
  const hasClerk = Boolean(process.env.CLERK_SECRET_KEY);
  try {
    if (!hasDb) return json(res, 500, { ok: false, hasDb, hasClerk, error: 'Database env not configured (DATABASE_URL/NEON_DATABASE_URL)' });
    const sql = getDb();
    const rows = await sql`SELECT NOW() as now, current_database() as db`;
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
    let employees = null;
    try { employees = (await sql`SELECT count(*)::int n FROM employees`)[0]?.n ?? null; } catch (e) { employees = `err:${e?.message}`; }
    return json(res, 200, { ok: true, hasDb, hasClerk, db: rows[0], employees, tables: tables.map(t => t.table_name) });
  } catch (error) {
    console.error('[api/health]', error?.stack || error);
    return json(res, 500, { ok: false, hasDb, hasClerk, error: error?.message || 'Health check failed', code: error?.code || null });
  }
}
