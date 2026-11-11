-- HR/Payroll enhancements: attendance filtering support + pay status tracking
-- Safe to run repeatedly.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_pay_status') THEN
    CREATE TYPE attendance_pay_status AS ENUM ('unpaid', 'processing', 'paid');
  END IF;
END$$;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS pay_status attendance_pay_status NOT NULL DEFAULT 'unpaid';

CREATE INDEX IF NOT EXISTS idx_attendance_pay_status ON attendance (pay_status);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (status);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_clockin ON attendance (employee_id, clock_in DESC);

-- Optional convenience: current pay indicator on employee (manual/derived outside triggers for simplicity)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS payment_note TEXT;

COMMIT;
