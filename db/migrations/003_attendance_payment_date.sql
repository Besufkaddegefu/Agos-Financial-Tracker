-- Separate payment date from attendance date (payments may occur days/months later)
BEGIN;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS payment_date DATE,
  ADD COLUMN IF NOT EXISTS payment_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_payment_date ON attendance (payment_date);
CREATE INDEX IF NOT EXISTS idx_attendance_pay_status_payment_date ON attendance (pay_status, payment_date);

COMMIT;
