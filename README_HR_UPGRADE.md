# Agos Postpartum Care - HR & Payroll Upgrade

This project is a Vite + React dashboard (Agos Postpartum Care / BizGrow base) extended with:
- Neon PostgreSQL schema for `employees`, `attendance`, and `payroll_runs`
- Clerk authentication guards and strict RBAC (`owner` > `admin` > `employee`)
- Owner-only privilege management (controlled decrease pattern)
- HR & Staff Management UI (`/hr-payroll`) for employees and attendance logging
- Actor-attributed audit history and higher-role approval workflows
- Private employee self-service requests (`/my-requests`)
- Consistent 10-item numbered pagination on data lists

## Local Development

```bash
npm install
npm run dev
```

Without configuration, the app runs in **local mode**:
- Clerk is disabled (no sign-in required)
- HR data is stored in browser `localStorage` (`agos-hr-local-v1`) for UI testing
- RBAC defaults to owner locally so screens are accessible

To use Neon locally, set `VITE_USE_API=true` and configure the Clerk and database
variables in `.env.local`. Apply the schema with `npm run db:migrate`, then run
the frontend and API in separate terminals:

```bash
npm run dev
npm run dev:api
```

The local API server binds only to `127.0.0.1:3000`; Vite proxies `/api`
requests to it. HR data is read from Neon and is not added automatically.
To populate the HR page with clearly labeled synthetic records, run
`npm run db:seed:hr-demo`. This does not overwrite existing employees.

## Production Setup (Clerk + Neon + Vercel)

### 1) Database (Neon)
Apply the migrations in order with `npm run db:migrate`, or execute all SQL
files in `db/migrations/` in order in the Neon SQL editor.

### 2) Environment Variables
Set in Vercel Project Settings (and `.env.local` for local testing where appropriate):

```env
# Client (Vite)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Server (Vercel Functions / Node)
CLERK_SECRET_KEY=sk_test_...
DATABASE_URL=postgres://...neon.tech/...?...sslmode=require
# or
NEON_DATABASE_URL=postgres://...
```

### 3) Clerk Roles
Roles are read from Clerk user `publicMetadata.role` with values:
- `owner`
- `admin`
- `employee` (default when missing)

Assign an initial owner in Clerk dashboard:
```json
{ "role": "owner" }
```

### 4) RBAC Rules (Controlled Decrease)
- Only `owner` can access privilege management and change roles.
- Owners cannot demote their own account from the privilege screen.
- The privilege screen does not grant `owner` to prevent accidental escalation.
- API routes enforce role checks server-side; UI guards are convenience only.

### 5) Change Approvals and Audit History
Migrations `006_change_oversight.sql` and `007_employee_change_approvals.sql`
add actor attribution, `change_approvals`, and `audit_log`. Apply them before
using the approval or audit screens. Historical records without a stored actor
remain labeled as unknown; their creator cannot be inferred retroactively.

- Employees can add customers, record income and expenses, and submit their own
  attendance. Their attendance entries are recorded immediately.
- Employees cannot directly edit existing customer details or non-amount
  transaction details; an administrator handles those corrections.
- Employee deletions, income/expense amount changes, attendance corrections,
  and bulk actions wait for review. Pending requests do not change live records.
- Admins and Owners share approval rights for employee requests. Neither can
  approve their own request. Their own major actions take effect immediately
  and remain in the audit history.
- Only Owners can manage user roles. This is the account-level permission that
  remains distinct from the shared Admin/Owner approval rights.
- Owners can also link an existing Clerk account to an existing employee
  profile from **HR & Staff → User Privileges**. This links the account to the
  profile without creating another employee; an already-linked profile cannot
  be reassigned from this control.
- Employees use `/my-requests` to record attendance and track major changes
  they submitted for approval. Personal profile changes are maintained by an
  administrator and are not submitted as employee requests.
- Admins and Owners see an approval inbox on `/my-requests` and can review
  audit history in the friendly, non-technical **Approvals & Audit** tab in HR
  & Staff.
- Creator, requester, and reviewer names use the person’s full name where a
  linked employee record or Clerk profile provides one; email addresses are
  not used as display names.
- When database mode is enabled, failed writes are reported instead of being
  treated as successful local-only changes. Save buttons also prevent repeat
  submissions while a request is in progress.

## API Routes (Vercel)
- Employees may create customers, income, and expense records; deletion and
  financial amount changes follow the approval rules above.
- `GET/POST/PUT/PATCH/DELETE /api/employees` (admin+)
- `GET/PUT/PATCH/DELETE /api/attendance` (admin+); employees may read their own
  attendance and submit their own new attendance entries
- `GET/POST/PUT/PATCH/DELETE /api/payroll` (admin+)
- `GET/PATCH /api/privileges` (owner only)
- `GET/POST/PATCH /api/approvals` (self-service requests, higher-role review)
- `GET /api/audit` (admin+)

## HR UI
`src/pages/HRPayroll.jsx`
- Employee table with employment-type filter (temporary/part-time/full-time)
- Add/edit employee modal (wage/salary type + rates)
- Attendance logging/editing with automatic hour calculation
- Owner-only User Privileges tab (when Clerk configured)
- `/reports` is available to employees for recording income and expenses; amount
  changes and deletions are submitted for approval

## Notes / Security
- Never expose `CLERK_SECRET_KEY` or `DATABASE_URL` to the browser.
- `VITE_*` variables are public by design (publishable key only).
- Server routes validate roles and input; database enforces types/check constraints.
- Attendance `total_hours` is computed by DB generated column and also previewed client-side.

## Build

```bash
npm run build
```
