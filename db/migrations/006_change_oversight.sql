-- Actor attribution, audit history, and higher-role change approvals.
BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS created_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS created_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS created_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

ALTER TABLE revenues
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_clerk_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

CREATE TABLE IF NOT EXISTS change_approvals (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('compensation', 'employment', 'attendance', 'payroll', 'bulk')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('employees', 'attendance', 'payroll_runs', 'revenues', 'expenses')),
  entity_id TEXT,
  operation TEXT NOT NULL,
  requested_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  before_data JSONB,
  requested_by_clerk_id TEXT NOT NULL,
  requested_by_name TEXT,
  requested_by_role TEXT NOT NULL CHECK (requested_by_role IN ('owner', 'admin', 'employee')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled')),
  reviewed_by_clerk_id TEXT,
  reviewed_by_name TEXT,
  reviewed_by_role TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_change_approvals_status_created
  ON change_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_approvals_requester
  ON change_approvals (requested_by_clerk_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_clerk_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_clerk_id, created_at DESC);

COMMIT;
