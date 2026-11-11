import { getClerkDisplayNames } from './auth.js';

export const ROLE_RANK = Object.freeze({ employee: 1, admin: 2, owner: 3 });

function needsLinkedName(name, clerkId) {
  return !name || name.includes('@') || name === 'Unknown user' ||
    (clerkId && name === String(clerkId));
}

export async function actorName(sql, actor) {
  const name = String(actor?.name || '').trim();
  if (name && !needsLinkedName(name, actor?.userId)) return name;

  if (actor?.userId) {
    const employees = await sql`
      SELECT NULLIF(BTRIM(full_name), '') AS full_name
      FROM employees
      WHERE clerk_id = ${actor.userId}
      LIMIT 1`;
    const employeeName = String(employees[0]?.full_name || '').trim();
    if (employeeName && !employeeName.includes('@')) return employeeName;
    const clerkNames = await getClerkDisplayNames([actor.userId]);
    const clerkName = clerkNames.get(actor.userId);
    if (clerkName) return clerkName;
  }

  return 'Unknown user';
}

export async function resolveStoredNames(sql, records) {
  if (!Array.isArray(records) || !records.length) return records;

  const namePairs = [
    ['created_by_name', 'created_by_clerk_id'],
    ['updated_by_name', 'updated_by_clerk_id'],
    ['actor_name', 'actor_clerk_id'],
    ['requested_by_name', 'requested_by_clerk_id'],
    ['reviewed_by_name', 'reviewed_by_clerk_id'],
  ];
  const clerkIds = [...new Set(records.flatMap(record =>
    namePairs.flatMap(([nameKey, idKey]) => {
      const name = String(record[nameKey] || '').trim();
      const id = record[idKey];
      return id && needsLinkedName(name, id) ? [id] : [];
    })
  ))];
  const employees = clerkIds.length
    ? await sql`
        SELECT clerk_id, NULLIF(BTRIM(full_name), '') AS full_name
        FROM employees
        WHERE clerk_id = ANY(${clerkIds}::text[])`
    : [];
  const namesById = new Map(employees
    .filter(employee => employee.full_name && !employee.full_name.includes('@'))
    .map(employee => [employee.clerk_id, employee.full_name]));
  const missingIds = clerkIds.filter(id => !namesById.has(id));
  const clerkNames = await getClerkDisplayNames(missingIds);
  for (const [id, name] of clerkNames) namesById.set(id, name);

  return records.map(record => {
    const resolved = { ...record };
    for (const [nameKey, idKey] of namePairs) {
      if (!(nameKey in record)) continue;
      const name = String(record[nameKey] || '').trim();
      if (needsLinkedName(name, record[idKey])) {
        resolved[nameKey] = namesById.get(record[idKey]) || 'Unknown user';
      }
    }
    return resolved;
  });
}

export async function writeAudit(sql, {
  actor,
  action,
  entityType,
  entityId = null,
  before = null,
  after = null,
  metadata = {},
}) {
  await sql`
    INSERT INTO audit_log (
      actor_clerk_id, actor_name, actor_role, action, entity_type,
      entity_id, before_data, after_data, metadata
    )
    VALUES (
      ${actor?.userId || null}, ${await actorName(sql, actor)}, ${actor?.role || null},
      ${action}, ${entityType}, ${entityId == null ? null : String(entityId)},
      ${before == null ? null : JSON.stringify(before)}::jsonb,
      ${after == null ? null : JSON.stringify(after)}::jsonb,
      ${JSON.stringify(metadata)}::jsonb
    )`;
}

export async function createApproval(sql, {
  actor,
  category,
  entityType,
  entityId = null,
  operation,
  requestedData,
  before = null,
}) {
  const rows = await sql`
    INSERT INTO change_approvals (
      category, entity_type, entity_id, operation, requested_data, before_data,
      requested_by_clerk_id, requested_by_name, requested_by_role
    )
    VALUES (
      ${category}, ${entityType}, ${entityId == null ? null : String(entityId)},
      ${operation}, ${JSON.stringify(requestedData)}::jsonb,
      ${before == null ? null : JSON.stringify(before)}::jsonb,
      ${actor.userId}, ${await actorName(sql, actor)}, ${actor.role}
    )
    RETURNING *`;

  await writeAudit(sql, {
    actor,
    action: 'approval_requested',
    entityType,
    entityId,
    before,
    after: requestedData,
    metadata: { approvalId: rows[0].id, category, operation },
  });
  return rows[0];
}

export function requiresHigherApproval(actor, category) {
  return actor?.role === 'employee' &&
    ['compensation', 'employment', 'attendance', 'payroll', 'bulk', 'deletion', 'financial'].includes(category);
}
