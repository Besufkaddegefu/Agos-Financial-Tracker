-- Allow employee requests for customer, transaction, and destructive changes.
BEGIN;

ALTER TABLE change_approvals
  DROP CONSTRAINT IF EXISTS change_approvals_category_check,
  DROP CONSTRAINT IF EXISTS change_approvals_entity_type_check;

ALTER TABLE change_approvals
  ADD CONSTRAINT change_approvals_category_check
    CHECK (category IN ('compensation', 'employment', 'attendance', 'payroll', 'bulk', 'deletion', 'financial')),
  ADD CONSTRAINT change_approvals_entity_type_check
    CHECK (entity_type IN ('employees', 'attendance', 'payroll_runs', 'revenues', 'expenses', 'customers'));

COMMIT;
