import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import Pagination from '@/components/ui/pagination';
import { createApiClient } from '@/services/hrService';
import { useRBAC } from '@/hooks/useRBAC';
import OversightPanel from '@/components/OversightPanel';

const PAGE_SIZE = 10;

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function requestCategory(value) {
  return ({
    compensation: 'Pay changes',
    employment: 'Employment changes',
    attendance: 'Attendance changes',
    payroll: 'Payroll changes',
    deletion: 'Record deletion',
    financial: 'Transaction amount change',
    bulk: 'Multiple records',
  })[value] || humanize(value);
}

function requestStatus(value) {
  return ({
    pending: 'Waiting for review',
    approved: 'Approved',
    rejected: 'Not approved',
  })[value] || humanize(value);
}

function isMajorRequest(item) {
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

export default function MyRequests() {
  const { toast } = useToast();
  const { clerkConfigured, getToken, isSignedIn, role } = useRBAC();
  const isEmployee = role === 'employee';
  const useApi = String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';
  const api = useMemo(() => (useApi && clerkConfigured && isSignedIn ? createApiClient(getToken) : null), [useApi, clerkConfigured, isSignedIn, getToken]);
  const [employee, setEmployee] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [requests, setRequests] = useState([]);
  const [attendanceForm, setAttendanceForm] = useState({ clock_in: '', clock_out: '', status: 'present', notes: '' });
  const [correctionId, setCorrectionId] = useState(null);
  const [correction, setCorrection] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState('');
  const [attendancePage, setAttendancePage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);

  const load = useCallback(async () => {
    if (!isEmployee) {
      setLoading(false);
      return;
    }
    if (!api) {
      setError('Self-service requests require VITE_USE_API=true and an authenticated database connection.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [employees, ownAttendance, ownRequests] = await Promise.all([
        api.employees.list({ mine: 'true' }),
        api.attendance.list({ mine: 'true' }),
        api.approvals.list(),
      ]);
      const ownEmployee = Array.isArray(employees) ? employees[0] : null;
      setEmployee(ownEmployee || null);
      setAttendance(Array.isArray(ownAttendance) ? ownAttendance : []);
      setRequests(Array.isArray(ownRequests) ? ownRequests.filter(isMajorRequest) : []);
    } catch (loadError) {
      setError(loadError.message || 'Could not load your private request information.');
    } finally {
      setLoading(false);
    }
  }, [api, isEmployee]);

  useEffect(() => { load(); }, [load]);

  const pagedAttendance = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(attendance.length / PAGE_SIZE));
    const page = Math.min(attendancePage, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: attendance.slice(start, start + PAGE_SIZE), page, totalPages,
      total: attendance.length, start: attendance.length ? start + 1 : 0,
      end: Math.min(start + PAGE_SIZE, attendance.length),
    };
  }, [attendance, attendancePage]);

  const pagedRequests = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
    const page = Math.min(requestPage, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: requests.slice(start, start + PAGE_SIZE), page, totalPages,
      total: requests.length, start: requests.length ? start + 1 : 0,
      end: Math.min(start + PAGE_SIZE, requests.length),
    };
  }, [requests, requestPage]);

  const submit = async body => {
    if (saveLock.current) return false;
    saveLock.current = true;
    setSaving(true);
    try {
      await api.approvals.submit(body);
      toast.success('Your request was sent for review. Your current record has not changed.');
      await load();
      return true;
    } catch (submitError) {
      toast.error(submitError.message || 'Could not submit your request.');
      return false;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const submitAttendance = async event => {
    event.preventDefault();
    if (saveLock.current) return;
    if (!attendanceForm.clock_in) {
      toast.error('Clock-in time is required.');
      return;
    }
    saveLock.current = true;
    setSaving(true);
    try {
      await api.attendance.create({
        employee_id: employee.id,
        clock_in: new Date(attendanceForm.clock_in).toISOString(),
        clock_out: attendanceForm.clock_out ? new Date(attendanceForm.clock_out).toISOString() : null,
        status: attendanceForm.status,
        notes: attendanceForm.notes || null,
      });
      setAttendanceForm({ clock_in: '', clock_out: '', status: 'present', notes: '' });
      toast.success('Your attendance was recorded.');
      await load();
    } catch (submitError) {
      toast.error(submitError.message || 'Could not record your attendance.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const submitCorrection = async (event, item) => {
    event.preventDefault();
    const sent = await submit({
      entity_type: 'attendance',
      operation: 'update',
      entity_id: item.id,
      requested_data: {
        clock_in: correction.clock_in ? new Date(correction.clock_in).toISOString() : undefined,
        clock_out: correction.clock_out ? new Date(correction.clock_out).toISOString() : null,
        status: correction.status,
        notes: correction.notes || null,
      },
    });
    if (sent) setCorrectionId(null);
  };

  if (!isEmployee) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl space-y-4">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Approval inbox</h1>
            <p className="mt-1 text-sm text-slate-600">Review employee requests here. Approved changes are applied to the records; rejected requests leave the records unchanged.</p>
          </header>
          <OversightPanel api={api} showAudit={false} inboxOnly />
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-6 text-slate-500">Loading your requests…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">My Requests</h1>
          <p className="mt-1 text-sm text-slate-600">Track important changes you have asked an administrator to review. Your current records stay unchanged until a request is approved.</p>
        </header>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {!error && !employee && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No employee profile is linked to your signed-in account. Ask an administrator to link your Clerk user ID.</div>}

        {employee && isEmployee && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Record your attendance</h2>
              <p className="mt-1 text-sm text-slate-500">New entries are recorded right away. Ask for approval to correct or remove an existing entry.</p>
              <form onSubmit={submitAttendance} className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Clock in<input required type="datetime-local" value={attendanceForm.clock_in} onChange={event => setAttendanceForm(current => ({ ...current, clock_in: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Clock out<input type="datetime-local" value={attendanceForm.clock_out} onChange={event => setAttendanceForm(current => ({ ...current, clock_out: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Status<select value={attendanceForm.status} onChange={event => setAttendanceForm(current => ({ ...current, status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">{['present', 'absent', 'late', 'half_day', 'leave'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label>
                <label className="text-sm font-medium text-slate-700">Notes<input value={attendanceForm.notes} onChange={event => setAttendanceForm(current => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving...' : 'Record attendance'}</button>
              </form>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">My attendance records</h2>
              <div className="mt-3 divide-y divide-slate-100">
                {pagedAttendance.items.map(item => (
                  <article key={item.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-700">{formatTime(item.clock_in)} — {item.clock_out ? formatTime(item.clock_out) : 'No clock-out'} · {item.status}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setCorrectionId(item.id); setCorrection({ clock_in: toLocalInput(item.clock_in), clock_out: toLocalInput(item.clock_out), status: item.status, notes: item.notes || '' }); }} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">Request correction</button>
                        <button type="button" disabled={saving} onClick={() => submit({ entity_type: 'attendance', operation: 'delete', entity_id: item.id, requested_data: {} })} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700">Request removal</button>
                      </div>
                    </div>
                    {correctionId === item.id && (
                      <form onSubmit={event => submitCorrection(event, item)} className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                        <input type="datetime-local" value={correction.clock_in || ''} onChange={event => setCorrection(current => ({ ...current, clock_in: event.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
                        <input type="datetime-local" value={correction.clock_out || ''} onChange={event => setCorrection(current => ({ ...current, clock_out: event.target.value }))} className="rounded border border-slate-300 px-2 py-1.5" />
                        <select value={correction.status || ''} onChange={event => setCorrection(current => ({ ...current, status: event.target.value }))} className="rounded border border-slate-300 px-2 py-1.5">{['present', 'absent', 'late', 'half_day', 'leave'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select>
                        <input value={correction.notes || ''} onChange={event => setCorrection(current => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="rounded border border-slate-300 px-2 py-1.5" />
                        <div className="flex gap-2 sm:col-span-2">
                          <button disabled={saving} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Submit correction</button>
                          <button type="button" onClick={() => setCorrectionId(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
                {!attendance.length && <p className="py-6 text-center text-sm text-slate-500">No attendance records yet.</p>}
              </div>
              <Pagination {...pagedAttendance} pageSize={PAGE_SIZE} onPage={setAttendancePage} />
            </section>
          </>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Major change requests</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {pagedRequests.items.map(item => (
              <article key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{requestCategory(item.category)} · {humanize(item.operation)}</p>
                  <p className="text-xs text-slate-500">{formatTime(item.created_at)}{item.review_note ? ` · ${item.review_note}` : ''}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : item.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{requestStatus(item.status)}</span>
              </article>
            ))}
            {!requests.length && <p className="py-6 text-center text-sm text-slate-500">You have not submitted any requests.</p>}
          </div>
          <Pagination {...pagedRequests} pageSize={PAGE_SIZE} onPage={setRequestPage} />
        </section>
        <p className="text-xs text-slate-500">Times shown in your browser’s local timezone.</p>
      </div>
    </div>
  );
}
