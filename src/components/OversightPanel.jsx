import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import Pagination from '@/components/ui/pagination';
import { useRBAC } from '@/hooks/useRBAC';
import { displayName } from '@/lib/displayName';

const PAGE_SIZE = 10;

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const fieldLabels = {
  full_name: 'Full name',
  employment_type: 'Employment type',
  salary_type: 'Pay schedule',
  base_rate: 'Pay rate',
  hire_date: 'Start date',
  clock_in: 'Clock-in time',
  clock_out: 'Clock-out time',
  amount: 'Amount',
  date: 'Date',
  status: 'Status',
  category: 'Category',
  source: 'Source',
  vendor: 'Vendor',
  description: 'Description',
  notes: 'Notes',
  email: 'Email',
  phone: 'Phone',
  name: 'Name',
  company: 'Company',
  pay_status: 'Payment status',
  payment_date: 'Payment date',
  payment_notes: 'Payment notes',
  customer_name: 'Customer',
  total_value: 'Customer value',
  last_purchase_date: 'Last purchase date',
  acquisition_date: 'Date added',
  receipt_url: 'Receipt',
  record_count: 'Number of records',
  created_at: 'Recorded on',
  updated_at: 'Last updated',
};

const dateFields = new Set([
  'date', 'hire_date', 'payment_date', 'last_purchase_date',
  'acquisition_date', 'created_at', 'updated_at', 'clock_in', 'clock_out',
]);
const dateOnlyFields = new Set([
  'date', 'hire_date', 'payment_date', 'last_purchase_date', 'acquisition_date',
]);
const labelValueFields = new Set([
  'status', 'category', 'employment_type', 'salary_type', 'pay_status',
]);

const hiddenFields = new Set([
  'id', 'approvalId', 'entityId', 'requestedBy', 'entity_id', 'ids',
  'employee_id', 'customer_id',
  'actor_clerk_id', 'requested_by_clerk_id', 'reviewed_by_clerk_id',
  'clerk_id', 'created_by_clerk_id', 'created_by_name',
  'updated_by_clerk_id', 'updated_by_name',
]);

function humanize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function friendlyValue(value, field) {
  if (value == null || value === '') return 'Not provided';
  if (field === 'receipt_url') return 'Receipt available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'Additional details';
  const text = String(value);
  if (dateFields.has(field)) {
    const datePart = text.slice(0, 10);
    const dateOnly = dateOnlyFields.has(field) || /^\d{4}-\d{2}-\d{2}$/.test(text);
    const date = new Date(dateOnly ? `${datePart}T00:00:00` : text);
    if (!Number.isNaN(date.getTime())) {
      return dateOnly ? date.toLocaleDateString() : date.toLocaleString();
    }
  }
  if (labelValueFields.has(field)) return humanize(text);
  return text.includes('_') ? humanize(text) : text;
}

function ChangeDetails({ value, label }) {
  if (value == null) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [`Item ${index + 1}`, item])
    : typeof value === 'object'
      ? Object.entries(value)
        .filter(([key]) => !hiddenFields.has(key) || key === 'ids')
        .map(([key, item]) => key === 'ids' ? ['record_count', item.length] : [key, item])
      : [[label, value]];
  if (!entries.length) return null;

  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer font-medium text-blue-700">{label}</summary>
      <dl className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
        {entries.map(([key, item]) => {
          const itemLabel = fieldLabels[key] || humanize(key);
          const isNested = item && typeof item === 'object';
          return (
            <div key={key} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0">
              <dt className="font-medium text-slate-700">{itemLabel}</dt>
              <dd className="mt-0.5 break-words text-slate-600">
                {isNested
                  ? <ChangeDetails value={item} label={`View ${itemLabel.toLowerCase()}`} />
                  : friendlyValue(item, key)}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

function operationLabel(operation) {
  return ({
    create: 'Add',
    update: 'Edit',
    delete: 'Delete',
    bulk_create: 'Add multiple',
    bulk_update: 'Update multiple',
    bulk_delete: 'Delete multiple',
  })[operation] || humanize(operation);
}

function entityLabel(entityType) {
  return ({
    employees: 'employee',
    attendance: 'attendance record',
    customers: 'customer',
    revenues: 'income record',
    expenses: 'expense',
    payroll_runs: 'payroll record',
  })[entityType] || humanize(entityType).toLowerCase();
}

function categoryLabel(category) {
  return ({
    compensation: 'Pay changes',
    employment: 'Employment changes',
    attendance: 'Attendance changes',
    payroll: 'Payroll changes',
    financial: 'Transaction amount change',
    deletion: 'Record deletion',
    bulk: 'Multiple records',
  })[category] || humanize(category);
}

function statusLabel(status) {
  return ({
    pending: 'Waiting for review',
    approved: 'Approved',
    rejected: 'Not approved',
  })[status] || humanize(status);
}

function isMajorEmployeeRequest(item) {
  if (item.category === 'deletion') {
    return ['customers', 'revenues', 'expenses'].includes(item.entity_type) &&
      item.operation === 'delete';
  }
  if (item.category === 'financial') {
    return ['revenues', 'expenses'].includes(item.entity_type) &&
      item.operation === 'update';
  }
  if (item.category === 'bulk') return String(item.operation).startsWith('bulk_');
  if (item.category === 'attendance') {
    return item.entity_type === 'attendance' &&
      ['update', 'delete'].includes(item.operation);
  }
  return item.category === 'payroll' && item.entity_type === 'payroll_runs';
}

export default function OversightPanel({ api, showAudit = true, inboxOnly = false }) {
  const { toast } = useToast();
  const { role, userId } = useRBAC();
  const [approvals, setApprovals] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [approvalPage, setApprovalPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!api) {
      setLoading(false);
      setError('Connect to the authenticated API to view approval and audit records.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [requests, events] = await Promise.all([
        api.approvals.list(),
        showAudit ? api.audit.list() : Promise.resolve([]),
      ]);
      const visibleRequests = Array.isArray(requests) ? requests : [];
      setApprovals(inboxOnly
        ? visibleRequests.filter(item =>
          item.status === 'pending' &&
          item.requested_by_clerk_id !== userId &&
          item.requested_by_role === 'employee' &&
          isMajorEmployeeRequest(item) &&
          ['admin', 'owner'].includes(role)
        )
        : visibleRequests);
      setAudit(Array.isArray(events) ? events : []);
    } catch (loadError) {
      setError(loadError.message || 'Could not load oversight records.');
    } finally {
      setLoading(false);
    }
  }, [api, inboxOnly, role, showAudit, userId]);

  useEffect(() => { load(); }, [load]);

  const pagedApprovals = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(approvals.length / PAGE_SIZE));
    const page = Math.min(approvalPage, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: approvals.slice(start, start + PAGE_SIZE),
      page, totalPages, total: approvals.length, start: approvals.length ? start + 1 : 0,
      end: Math.min(start + PAGE_SIZE, approvals.length),
    };
  }, [approvals, approvalPage]);

  const pagedAudit = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(audit.length / PAGE_SIZE));
    const page = Math.min(auditPage, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: audit.slice(start, start + PAGE_SIZE),
      page, totalPages, total: audit.length, start: audit.length ? start + 1 : 0,
      end: Math.min(start + PAGE_SIZE, audit.length),
    };
  }, [audit, auditPage]);

  const review = async (item, status) => {
    setBusyId(item.id);
    try {
      await api.approvals.review(item.id, status, reviewNote);
      toast.success(`Request ${status}.`);
      setReviewNote('');
      await load();
    } catch (reviewError) {
      toast.error(reviewError.message || `Could not ${status} request.`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="p-6 text-sm text-slate-500">{inboxOnly ? 'Loading approval requests…' : 'Loading approvals and audit history…'}</p>;

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">{inboxOnly ? 'Requests awaiting your approval' : 'Change approvals'}</h2>
          <p className="text-sm text-slate-500">{inboxOnly
            ? 'Review each employee request. Approving applies the requested change; rejecting leaves the record as it is.'
            : 'Changes are applied only after an eligible higher-role approver accepts them. Requesters cannot approve their own changes.'}</p>
        </div>
        {pagedApprovals.items.length ? (
          <div className="divide-y divide-slate-100">
            {pagedApprovals.items.map(item => {
              const canReview = item.status === 'pending' &&
                item.requested_by_clerk_id !== userId &&
                ['admin', 'owner'].includes(role) &&
                item.requested_by_role === 'employee';
              return (
                <article key={item.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {operationLabel(item.operation)} {entityLabel(item.entity_type)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {categoryLabel(item.category)} · {statusLabel(item.status)} · requested by {displayName(item.requested_by_name)} · {formatTime(item.created_at)}
                      </p>
                    </div>
                    {item.reviewed_at && <span className="text-xs text-slate-500">Reviewed {formatTime(item.reviewed_at)} by {displayName(item.reviewed_by_name, 'Unknown reviewer')}</span>}
                  </div>
                  <ChangeDetails value={item.before_data} label="Current information" />
                  <ChangeDetails value={item.requested_data} label="Requested changes" />
                  {item.review_note && <p className="mt-2 text-sm text-slate-600">Review note: {item.review_note}</p>}
                  {canReview && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="Optional review note" className="min-w-52 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      <button type="button" disabled={busyId === item.id} onClick={() => review(item, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve & apply</button>
                      <button type="button" disabled={busyId === item.id} onClick={() => review(item, 'rejected')} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Reject</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-500">No approval requests to show.</p>}
        <Pagination {...pagedApprovals} pageSize={PAGE_SIZE} onPage={setApprovalPage} />
      </section>

      {showAudit && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Audit history</h2>
          <p className="text-sm text-slate-500">Recent actor, action, timestamp, and before/after details. Legacy records without attribution remain marked unknown.</p>
        </div>
        {pagedAudit.items.length ? (
          <div className="divide-y divide-slate-100">
            {pagedAudit.items.map(event => (
              <article key={event.id} className="py-4 first:pt-0 last:pb-0">
                <p className="font-medium text-slate-900">{humanize(event.action)} · {entityLabel(event.entity_type)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {displayName(event.actor_name)}{event.actor_role ? ` · ${humanize(event.actor_role)}` : ''} · {formatTime(event.created_at)}
                </p>
                <ChangeDetails value={event.before_data} label="Previous information" />
                <ChangeDetails value={event.after_data} label="Updated information" />
                <ChangeDetails value={event.metadata} label="More information" />
              </article>
            ))}
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-500">No audit events have been recorded yet.</p>}
        <Pagination {...pagedAudit} pageSize={PAGE_SIZE} onPage={setAuditPage} />
      </section>}
    </div>
  );
}
