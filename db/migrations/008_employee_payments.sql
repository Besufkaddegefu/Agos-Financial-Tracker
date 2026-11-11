-- A separate ledger of actual employee payments, including partial payments.
BEGIN;

CREATE TABLE IF NOT EXISTS employee_payments (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  payroll_run_id BIGINT REFERENCES payroll_runs(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'other'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'mobile_money', 'check', 'other')),
  reference TEXT,
  notes TEXT,
  created_by_clerk_id TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_payments_employee_date
  ON employee_payments (employee_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_payments_payroll_run
  ON employee_payments (payroll_run_id);

COMMIT;
