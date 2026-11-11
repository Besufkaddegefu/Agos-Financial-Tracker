-- Align the database with the HR UI's per_service salary type.
-- Older databases may still have per_service_commission and it remains valid.
ALTER TYPE salary_type ADD VALUE IF NOT EXISTS 'per_service';
