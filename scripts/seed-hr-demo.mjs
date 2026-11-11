import fs from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const separator = line.indexOf('=');
      const key = line.slice(0, separator).trim();
      if (!process.env[key]) process.env[key] = line.slice(separator + 1).trim();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadEnvFile(path.resolve('.env.local'));
loadEnvFile(path.resolve('.env'));

const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL or NEON_DATABASE_URL is required');

const sql = neon(databaseUrl);
const demoEmployees = [
  {
    name: 'Demo Staff - Alex Example',
    email: 'demo.alex@example.invalid',
    employmentType: 'full_time',
    salaryType: 'monthly_salary',
    rate: 3500,
    hireDate: '2026-11-01',
  },
  {
    name: 'Demo Staff - Jamie Example',
    email: 'demo.jamie@example.invalid',
    employmentType: 'part_time',
    salaryType: 'hourly_wage',
    rate: 24.5,
    hireDate: '2026-11-02',
  },
  {
    name: 'Demo Staff - Taylor Example',
    email: 'demo.taylor@example.invalid',
    employmentType: 'temporary',
    salaryType: 'per_service',
    rate: 75,
    hireDate: '2026-11-03',
  },
];

for (const employee of demoEmployees) {
  await sql`
    INSERT INTO employees (full_name, email, employment_type, salary_type, base_rate, hire_date, status)
    VALUES (
      ${employee.name}, ${employee.email}, ${employee.employmentType},
      ${employee.salaryType}, ${employee.rate}, ${employee.hireDate}, 'active'
    )
    ON CONFLICT (email) DO NOTHING`;
}

const demoAttendance = [
  {
    email: 'demo.alex@example.invalid',
    clockIn: '2026-11-06T08:00:00Z',
    clockOut: '2026-11-06T17:00:00Z',
    status: 'present',
    payStatus: 'unpaid',
    notes: 'Demo data - not a real employee record.',
  },
  {
    email: 'demo.jamie@example.invalid',
    clockIn: '2026-11-07T09:00:00Z',
    clockOut: '2026-11-07T13:00:00Z',
    status: 'present',
    payStatus: 'paid',
    paymentDate: '2026-11-08',
    notes: 'Demo data - not a real employee record.',
  },
  {
    email: 'demo.taylor@example.invalid',
    clockIn: '2026-11-08T08:00:00Z',
    clockOut: '2026-11-08T12:00:00Z',
    status: 'late',
    payStatus: 'processing',
    notes: 'Demo data - not a real employee record.',
  },
];

for (const record of demoAttendance) {
  await sql`
    INSERT INTO attendance (
      employee_id, clock_in, clock_out, status, pay_status, payment_date, notes
    )
    SELECT e.id, ${record.clockIn}::timestamptz, ${record.clockOut}::timestamptz,
      ${record.status}, ${record.payStatus}, ${record.paymentDate || null}, ${record.notes}
    FROM employees e
    WHERE e.email = ${record.email}
      AND NOT EXISTS (
        SELECT 1
        FROM attendance a
        WHERE a.employee_id = e.id AND a.clock_in = ${record.clockIn}::timestamptz
      )`;
}

const counts = (await sql`
  SELECT
    (SELECT count(*)::int FROM employees WHERE email LIKE 'demo.%@example.invalid') AS employees,
    (SELECT count(*)::int FROM attendance WHERE notes = 'Demo data - not a real employee record.') AS attendance`)[0];

console.log(`Demo HR rows present in Neon: employees=${counts.employees}, attendance=${counts.attendance}`);
