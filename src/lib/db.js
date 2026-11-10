// Neon/PostgreSQL serverless client wrapper.
// Safe for Vercel serverless/edge-compatible Node runtimes when using @neondatabase/serverless.
// In browser builds, direct DB access is not performed; use API/service wrappers.

let sqlClient = null;

export async function getSql() {
  if (typeof window !== 'undefined') {
    throw new Error('Direct database access is not available in the browser. Use API services.');
  }
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL (or NEON_DATABASE_URL) is not configured.');
  }
  // Dynamic import keeps this module browser-safe for bundlers that tree-shake server paths.
  const { neon } = await import('@neondatabase/serverless');
  sqlClient = neon(url);
  return sqlClient;
}

export async function query(strings, ...values) {
  const sql = await getSql();
  return sql(strings, ...values);
}
