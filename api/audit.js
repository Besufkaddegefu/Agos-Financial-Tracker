import { getDb } from './_lib/db.js';
import { requireRole, json, handleApiError } from './_lib/auth.js';
import { ROLES } from './_lib/rbac.js';
import { resolveStoredNames } from './_lib/workflow.js';

export default async function handler(req, res) {
  try {
    await requireRole(req, ROLES.ADMIN);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { error: 'Method not allowed' });
    }

    const sql = getDb();
    const entityType = req.query?.entity_type || null;
    const rows = await sql`
      SELECT id, actor_clerk_id, actor_name, actor_role, action, entity_type,
             entity_id, before_data, after_data, metadata, created_at
      FROM audit_log
      WHERE (${entityType}::text IS NULL OR entity_type = ${entityType})
      ORDER BY created_at DESC
      LIMIT 500`;
    return json(res, 200, { data: await resolveStoredNames(sql, rows) });
  } catch (error) {
    return handleApiError(res, error);
  }
}
