import { neonConfig, Pool } from '@neondatabase/serverless';
import WebSocket from 'ws';

let sql;
let pool;
neonConfig.webSocketConstructor = WebSocket;

export function getDb() {
  if (sql) return sql;
  getDbPool();
  sql = createPoolTag();
  return sql;
}

function getDbPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!url) {
    const err = new Error('Database not configured');
    err.status = 500;
    err.details = 'Set DATABASE_URL or NEON_DATABASE_URL on the API server';
    throw err;
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

function createTransactionTag(client) {
  return (strings, ...values) => {
    const text = buildQueryText(strings);
    return client.query(text, values).then(result => result.rows);
  };
}

function createPoolTag() {
  return async (strings, ...values) => {
    const client = await getDbPool().connect();
    try {
      return await createTransactionTag(client)(strings, ...values);
    } finally {
      client.release();
    }
  };
}

function buildQueryText(strings) {
  let text = strings[0];
  for (let index = 1; index < strings.length; index += 1) {
    text += `$${index}${strings[index]}`;
  }
  return text;
}

export async function withTransaction(work) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(createTransactionTag(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] transaction rollback failed:', rollbackError?.message || rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
