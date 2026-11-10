-- Core app tables: customers, revenues, expenses (Neon/PostgreSQL)
-- These are optional for the localStorage-only mode but required for DB-backed mode.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_status') THEN
    CREATE TYPE customer_status AS ENUM ('active','inactive','potential');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenue_category') THEN
    CREATE TYPE revenue_category AS ENUM ('product_sales','service_revenue','subscription','consulting','licensing','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_category') THEN
    CREATE TYPE expense_category AS ENUM ('office_supplies','marketing','software','travel','utilities','rent','salaries','equipment','professional_services','other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  status customer_status NOT NULL DEFAULT 'potential',
  acquisition_date DATE,
  total_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_purchase_date DATE,
  created_by_clerk_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_email_unique UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_acquisition_date ON customers(acquisition_date DESC);

CREATE TABLE IF NOT EXISTS revenues (
  id BIGSERIAL PRIMARY KEY,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  source TEXT,
  category revenue_category NOT NULL DEFAULT 'product_sales',
  date DATE NOT NULL,
  customer_name TEXT,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  description TEXT,
  created_by_clerk_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revenues_date ON revenues(date DESC);
CREATE INDEX IF NOT EXISTS idx_revenues_category ON revenues(category);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category expense_category NOT NULL DEFAULT 'other',
  vendor TEXT,
  date DATE NOT NULL,
  description TEXT,
  receipt_url TEXT,
  created_by_clerk_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_customers_updated_at') THEN CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_revenues_updated_at') THEN CREATE TRIGGER trg_revenues_updated_at BEFORE UPDATE ON revenues FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_expenses_updated_at') THEN CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF;
END $$;

COMMIT;
