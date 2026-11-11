-- HR & Payroll schema for Agos Postpartum Care (Neon / PostgreSQL)
-- Safe to run repeatedly where possible (idempotent enum/table creation patterns).

BEGIN;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'temporary');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_type') THEN
    CREATE TYPE salary_type AS ENUM ('monthly_salary', 'hourly_wage', 'per_service');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_status') THEN
    CREATE TYPE employee_status AS ENUM ('active', 'inactive', 'on_leave', 'terminated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'half_day', 'leave');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_status') THEN
    CREATE TYPE payroll_status AS ENUM ('draft', 'approved', 'paid', 'void');
  END IF;
END$$;

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id              BIGSERIAL PRIMARY KEY,
  clerk_id        TEXT UNIQUE, -- nullable for pre-provisioned staff not yet linked
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  salary_type     salary_type NOT NULL DEFAULT 'monthly_salary',
  base_rate       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (base_rate >= 0),
  hire_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status          employee_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employees_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_employees_clerk_id ON employees (clerk_id);
CREATE INDEX IF NOT EXISTS idx_employees_employment_type ON employees (employment_type);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_in     TIMESTAMPTZ NOT NULL,
  clock_out    TIMESTAMPTZ,
  total_hours  NUMERIC(6,2) GENERATED ALWAYS AS (
                 CASE
                   WHEN clock_out IS NULL THEN NULL
                   ELSE ROUND(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0, 2)
                 END
               ) STORED,
  status       attendance_status NOT NULL DEFAULT 'present',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_clock_order CHECK (clock_out IS NULL OR clock_out >= clock_in)
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_clock_in ON attendance (clock_in);

-- Payroll runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id               BIGSERIAL PRIMARY KEY,
  employee_id      BIGINT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  pay_period_start DATE NOT NULL,
  pay_period_end   DATE NOT NULL,
  total_units      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_units >= 0), -- hours or services
  gross_pay        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gross_pay >= 0),
  deductions       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  net_pay          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (net_pay >= 0),
  status           payroll_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_period_order CHECK (pay_period_end >= pay_period_start),
  CONSTRAINT payroll_net_consistency CHECK (net_pay = gross_pay - deductions)
);

CREATE INDEX IF NOT EXISTS idx_payroll_employee_id ON payroll_runs (employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_runs (pay_period_start, pay_period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_runs (status);

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_employees_updated_at') THEN
    CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON employees
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_updated_at') THEN
    CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON attendance
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payroll_runs_updated_at') THEN
    CREATE TRIGGER trg_payroll_runs_updated_at BEFORE UPDATE ON payroll_runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;

COMMIT;
