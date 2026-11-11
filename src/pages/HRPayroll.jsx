import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Briefcase,
  Users,
  Clock,
  Plus,
  Edit,
  Trash2,
  Shield,
  Filter,
  Search,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Layers,
  DollarSign,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ConfirmationModal from '@/components/ui/confirmation-modal';
import { useToast } from '@/components/ui/toast';
import { useRBAC } from '@/hooks/useRBAC';
import { localHrStore, createApiClient } from '@/services/hrService';
import { ROLE_LABELS, ROLES } from '@/lib/rbac';
import OversightPanel from '@/components/OversightPanel';
import Pagination from '@/components/ui/pagination';
import { displayName } from '@/lib/displayName';

const EMPLOYMENT_TYPES = [
  { value: '', label: 'All types' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'temporary', label: 'Temporary' },
];
const SALARY_TYPES = [
  { value: 'monthly_salary', label: 'Monthly salary' },
  { value: 'hourly_wage', label: 'Hourly wage' },
  { value: 'per_service', label: 'Per service' },
  { value: 'per_service_commission', label: 'Per service commission' },
];
const EMPLOYEE_STATUSES = ['active', 'inactive', 'on_leave', 'terminated'];
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'half_day', 'leave'];
const PAY_STATUSES = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'processing', label: 'Processing' },
  { value: 'paid', label: 'Paid' },
];

function fmtMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00';
}
function calcHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return null;
  const diff = (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 36e5;
  return Number.isFinite(diff) && diff >= 0 ? Number(diff.toFixed(2)) : null;
}
function toLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function dayBounds(dateStr, end = false) {
  if (!dateStr) return null;
  return `${dateStr}T${end ? '23:59:59' : '00:00:00'}`;
}

const emptyEmployee = {
  full_name: '', email: '', phone: '', clerk_id: '',
  employment_type: 'full_time', salary_type: 'monthly_salary',
  base_rate: '', hire_date: format(new Date(), 'yyyy-MM-dd'), status: 'active',
};
const emptyAttendance = {
  employee_id: '', clock_in: '', clock_out: '', status: 'present', pay_status: 'unpaid', payment_date: '', payment_notes: '', notes: '',
};
const emptyBulk = {
  date: format(new Date(), 'yyyy-MM-dd'),
  clock_in_time: '08:00',
  clock_out_time: '17:00',
  status: 'present',
  notes: '',
  employee_ids: [],
};
const emptyPayroll = {
  employee_id: '',
  pay_period_start: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'),
  pay_period_end: format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'),
  total_units: '0',
  gross_pay: '',
  deductions: '0',
  status: 'draft',
};
const emptyPayment = {
  employee_id: '',
  payroll_run_id: '',
  amount: '',
  payment_date: format(new Date(), 'yyyy-MM-dd'),
  payment_method: 'bank_transfer',
  reference: '',
  notes: '',
};

export default function HRPayroll() {
  const { toast } = useToast();
  const { canManagePrivileges, clerkConfigured, getToken, isSignedIn } = useRBAC();
  const useApi = String(import.meta.env.VITE_USE_API || '').toLowerCase() === 'true';
  const api = useMemo(() => (useApi && clerkConfigured && isSignedIn ? createApiClient(getToken) : null), [useApi, clerkConfigured, isSignedIn, getToken]);

  const [tab, setTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState('');
  const [showPayrollForm, setShowPayrollForm] = useState(false);
  const [payrollForm, setPayrollForm] = useState(emptyPayroll);
  const [payrollErrors, setPayrollErrors] = useState({});
  const [payrollSaving, setPayrollSaving] = useState(false);
  const payrollSaveLock = useRef(false);
  const [employeePayments, setEmployeePayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState('');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [paymentErrors, setPaymentErrors] = useState({});
  const [paymentSaving, setPaymentSaving] = useState(false);
  const paymentSaveLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({ employees: '', attendance: '' });
  const [empFilters, setEmpFilters] = useState({ q: '', status: '', employment_type: '', salary_type: '', sort: 'name_asc' });

  const [attFilters, setAttFilters] = useState({
    employee_id: '', date_from: '', date_to: '', status: '', sort: 'desc', q: '',
  });
  const [selectedAttIds, setSelectedAttIds] = useState([]);
  const [bulkPayStatus, setBulkPayStatus] = useState('paid');

  const [payFilters, setPayFilters] = useState({
    employee_id: '', date_from: '', date_to: '', time_from: '', time_to: '', status: '', pay_status: '', employment_type: '', payment_date_from: '', payment_date_to: '', sort: 'date_desc', q: '',
  });
  const [selectedPayIds, setSelectedPayIds] = useState([]);
  const [payBulkStatus, setPayBulkStatus] = useState('paid');
  const [payBulkDate, setPayBulkDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payBulkNotes, setPayBulkNotes] = useState('');

  const [pageState, setPageState] = useState({ employees: 1, attendance: 1, payments: 1, paymentSummary: 1, payroll: 1, ledgerPayments: 1, privileges: 1 });
  const pageSizes = { employees: 10, attendance: 10, payments: 10, paymentSummary: 10, payroll: 10, ledgerPayments: 10, privileges: 10 };

  const [showEmpForm, setShowEmpForm] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [empForm, setEmpForm] = useState(emptyEmployee);
  const [empErrors, setEmpErrors] = useState({});
  const [employeeSaving, setEmployeeSaving] = useState(false);
  const employeeSaveLock = useRef(false);

  const [showAttForm, setShowAttForm] = useState(false);
  const [editingAtt, setEditingAtt] = useState(null);
  const [attForm, setAttForm] = useState(emptyAttendance);
  const [attErrors, setAttErrors] = useState({});
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const attendanceSaveLock = useRef(false);

  const [showBulk, setShowBulk] = useState(false);
  const [bulk, setBulk] = useState(emptyBulk);
  const [bulkErrors, setBulkErrors] = useState({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkLock = useRef(false);
  const deleteLock = useRef(false);

  const [confirm, setConfirm] = useState({ open: false, kind: null, id: null });
  const [privUsers, setPrivUsers] = useState([]);
  const [linkableEmployees, setLinkableEmployees] = useState([]);
  const [privLoading, setPrivLoading] = useState(false);
  const [linkingUserId, setLinkingUserId] = useState(null);

  const loadEmployees = useCallback(async () => {
    try {
      const params = empFilters.employment_type ? { employment_type: empFilters.employment_type } : {};
      const data = api
        ? await api.employees.list(params)
        : await localHrStore.employees.list(params);
      setEmployees(Array.isArray(data) ? data : []);
      setLoadErrors(errors => ({ ...errors, employees: '' }));
    } catch (e) {
      setEmployees([]);
      setLoadErrors(errors => ({ ...errors, employees: e.message || 'Request failed' }));
      toast.error(`Failed to load employees${api ? ' from the database' : ''}: ${e.message}`);
    }
  }, [api, empFilters.employment_type, toast]);

  const loadAttendance = useCallback(async () => {
    try {
      const params = {
        employee_id: attFilters.employee_id || undefined,
        status: attFilters.status || undefined,
        date_from: dayBounds(attFilters.date_from) || undefined,
        date_to: dayBounds(attFilters.date_to, true) || undefined,
        sort: attFilters.sort || 'desc',
      };
      const data = api
        ? await api.attendance.list(params)
        : await localHrStore.attendance.list(params);
      setAttendance(Array.isArray(data) ? data : []);
      setLoadErrors(errors => ({ ...errors, attendance: '' }));
    } catch (e) {
      setAttendance([]);
      setLoadErrors(errors => ({ ...errors, attendance: e.message || 'Request failed' }));
      toast.error(`Failed to load attendance${api ? ' from the database' : ''}: ${e.message}`);
    }
  }, [api, attFilters.employee_id, attFilters.status, attFilters.date_from, attFilters.date_to, attFilters.sort, toast]);

  const loadPayroll = useCallback(async () => {
    setPayrollLoading(true);
    setPayrollError('');
    try {
      const data = api
        ? await api.payroll.list()
        : await localHrStore.payroll.list();
      setPayrollRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      setPayrollRuns([]);
      setPayrollError(e.message || 'Could not load payroll runs.');
    } finally {
      setPayrollLoading(false);
    }
  }, [api]);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError('');
    try {
      const data = api
        ? await api.payments.list()
        : await localHrStore.payments.list();
      setEmployeePayments(Array.isArray(data) ? data : []);
    } catch (e) {
      setEmployeePayments([]);
      setPaymentsError(e.message || 'Could not load employee payments.');
    } finally {
      setPaymentsLoading(false);
    }
  }, [api]);

  const loadPrivileges = useCallback(async () => {
    if (!api || !canManagePrivileges) return;
    setPrivLoading(true);
    try {
      const [data, employeeData] = await Promise.all([
        api.privileges.listUsers(),
        api.employees.list(),
      ]);
      setPrivUsers(Array.isArray(data) ? data : []);
      setLinkableEmployees(Array.isArray(employeeData) ? employeeData : []);
    } catch (e) {
      console.warn('Privileges API failed:', e?.message);
      toast.warning(`Privileges unavailable: ${e.message} (requires owner + running API)`);
      setPrivUsers([]);
    } finally {
      setPrivLoading(false);
    }
  }, [api, canManagePrivileges, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadEmployees(), loadAttendance()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadEmployees, loadAttendance]);

  useEffect(() => { if (tab === 'privileges') loadPrivileges(); }, [tab, loadPrivileges]);
  useEffect(() => { if (tab === 'payroll') loadPayroll(); }, [tab, loadPayroll]);
  useEffect(() => {
    if (tab === 'payments') {
      loadPayments();
      loadPayroll();
    }
  }, [tab, loadPayments, loadPayroll]);

  useEffect(() => { setPageState(s => ({ ...s, employees: 1, privileges: 1 })); }, [empFilters, employees.length, privUsers.length]);
  useEffect(() => { setPageState(s => ({ ...s, attendance: 1 })); }, [attFilters, attendance.length, tab]);
  useEffect(() => { setPageState(s => ({ ...s, payments: 1, paymentSummary: 1 })); }, [payFilters, attendance.length, tab]);
  useEffect(() => { setPageState(s => ({ ...s, payroll: 1 })); }, [payrollRuns.length, tab]);
  useEffect(() => { setPageState(s => ({ ...s, ledgerPayments: 1 })); }, [employeePayments.length, tab]);
  useEffect(() => { setSelectedAttIds(ids => ids.filter(id => attendance.some(a => String(a.id) === String(id)))); }, [attendance]);
  useEffect(() => { setSelectedPayIds(ids => ids.filter(id => attendance.some(a => String(a.id) === String(id)))); }, [attendance]);

  const setPage = (key, value) => setPageState(s => ({ ...s, [key]: Math.max(1, value) }));
  const paginate = (items, key) => {
    const size = pageSizes[key] || 10;
    const totalPages = Math.max(1, Math.ceil(items.length / size));
    const page = Math.min(pageState[key] || 1, totalPages);
    const start = (page - 1) * size;
    return { items: items.slice(start, start + size), page, totalPages, size, total: items.length, start: items.length ? start + 1 : 0, end: Math.min(start + size, items.length) };
  };

  const filteredEmployees = useMemo(() => {
    const q = empFilters.q.trim().toLowerCase();
    let items = Array.isArray(employees) ? [...employees] : [];
    if (empFilters.employment_type) items = items.filter(e => e.employment_type === empFilters.employment_type);
    if (empFilters.status) items = items.filter(e => e.status === empFilters.status);
    if (empFilters.salary_type) items = items.filter(e => e.salary_type === empFilters.salary_type);
    if (q) items = items.filter(e => [e.full_name, e.email, e.phone, e.clerk_id].some(v => String(v || '').toLowerCase().includes(q)));
    items.sort((a, b) => {
      switch (empFilters.sort) {
        case 'name_desc': return String(b.full_name || '').localeCompare(String(a.full_name || ''));
        case 'rate_desc': return (Number(b.base_rate) || 0) - (Number(a.base_rate) || 0);
        case 'rate_asc': return (Number(a.base_rate) || 0) - (Number(b.base_rate) || 0);
        case 'hire_desc': return String(b.hire_date || '').localeCompare(String(a.hire_date || ''));
        case 'hire_asc': return String(a.hire_date || '').localeCompare(String(b.hire_date || ''));
        case 'name_asc':
        default: return String(a.full_name || '').localeCompare(String(b.full_name || ''));
      }
    });
    return items;
  }, [employees, empFilters]);

  const filteredAttendance = useMemo(() => {
    const q = attFilters.q.trim().toLowerCase();
    if (!q) return attendance;
    return attendance.filter(a =>
      String(a.employee_name || '').toLowerCase().includes(q) ||
      String(a.notes || '').toLowerCase().includes(q) ||
      String(a.status || '').toLowerCase().includes(q)
    );
  }, [attendance, attFilters.q]);

  const attendanceSummary = useMemo(() => {
    const items = filteredAttendance;
    const hours = items.reduce((s, a) => s + (Number(a.total_hours) || 0), 0);
    return {
      records: items.length,
      hours: Number(hours.toFixed(2)),
    };
  }, [filteredAttendance]);

  const employeePaySummary = useMemo(() => {
    const map = new Map();
    for (const a of attendance) {
      const id = String(a.employee_id);
      if (!map.has(id)) map.set(id, { id, name: a.employee_name || id, unpaid: 0, paid: 0, hours: 0 });
      const row = map.get(id);
      row.hours += Number(a.total_hours) || 0;
      if ((a.pay_status || 'unpaid') === 'paid') row.paid += 1; else row.unpaid += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.unpaid - a.unpaid || b.hours - a.hours);
  }, [attendance]);

  const employeeTypeMap = useMemo(() => new Map((employees || []).map(e => [String(e.id), e.employment_type || ''])), [employees]);

  const timeOfDay = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const filteredPayments = useMemo(() => {
    const q = payFilters.q.trim().toLowerCase();
    let items = Array.isArray(attendance) ? [...attendance] : [];
    if (payFilters.employee_id) items = items.filter(a => String(a.employee_id) === String(payFilters.employee_id));
    if (payFilters.status) items = items.filter(a => a.status === payFilters.status);
    if (payFilters.pay_status) items = items.filter(a => (a.pay_status || 'unpaid') === payFilters.pay_status);
    if (payFilters.employment_type) items = items.filter(a => employeeTypeMap.get(String(a.employee_id)) === payFilters.employment_type);
    if (payFilters.date_from) items = items.filter(a => a.clock_in && String(a.clock_in).slice(0, 10) >= payFilters.date_from);
    if (payFilters.date_to) items = items.filter(a => a.clock_in && String(a.clock_in).slice(0, 10) <= payFilters.date_to);
    if (payFilters.payment_date_from) items = items.filter(a => a.payment_date && String(a.payment_date).slice(0, 10) >= payFilters.payment_date_from);
    if (payFilters.payment_date_to) items = items.filter(a => a.payment_date && String(a.payment_date).slice(0, 10) <= payFilters.payment_date_to);
    if (payFilters.time_from) items = items.filter(a => { const t = timeOfDay(a.clock_in); return t && t >= payFilters.time_from; });
    if (payFilters.time_to) items = items.filter(a => { const t = timeOfDay(a.clock_in); return t && t <= payFilters.time_to; });
    if (q) items = items.filter(a => [a.employee_name, a.notes, a.payment_notes, a.status, a.pay_status, a.employee_id].some(v => String(v || '').toLowerCase().includes(q)));
    items.sort((a, b) => {
      switch (payFilters.sort) {
        case 'date_asc': return String(a.clock_in || '').localeCompare(String(b.clock_in || ''));
        case 'payment_date_desc': return String(b.payment_date || '').localeCompare(String(a.payment_date || '')) || String(b.clock_in || '').localeCompare(String(a.clock_in || ''));
        case 'payment_date_asc': return String(a.payment_date || '9999').localeCompare(String(b.payment_date || '9999')) || String(a.clock_in || '').localeCompare(String(b.clock_in || ''));
        case 'hours_desc': return (Number(b.total_hours) || 0) - (Number(a.total_hours) || 0);
        case 'hours_asc': return (Number(a.total_hours) || 0) - (Number(b.total_hours) || 0);
        case 'employee_asc': return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
        case 'employee_desc': return String(b.employee_name || '').localeCompare(String(a.employee_name || ''));
        case 'pay_status': return String(a.pay_status || 'unpaid').localeCompare(String(b.pay_status || 'unpaid'));
        case 'date_desc':
        default: return String(b.clock_in || '').localeCompare(String(a.clock_in || ''));
      }
    });
    return items;
  }, [attendance, payFilters, employeeTypeMap]);

  const paymentSummary = useMemo(() => {
    const hours = filteredPayments.reduce((s, a) => s + (Number(a.total_hours) || 0), 0);
    const employees = new Set(filteredPayments.map(a => String(a.employee_id))).size;
    const unpaid = filteredPayments.filter(a => (a.pay_status || 'unpaid') === 'unpaid').length;
    const processing = filteredPayments.filter(a => a.pay_status === 'processing').length;
    const paid = filteredPayments.filter(a => a.pay_status === 'paid').length;
    return { records: filteredPayments.length, employees, hours: Number(hours.toFixed(2)), unpaid, processing, paid };
  }, [filteredPayments]);

  const paymentEmployeeRows = useMemo(() => {
    const map = new Map();
    for (const a of filteredPayments) {
      const id = String(a.employee_id);
      const emp = employees.find(e => String(e.id) === id);
      if (!map.has(id)) map.set(id, { id, name: a.employee_name || emp?.full_name || id, employment_type: emp?.employment_type || '', rate: emp?.base_rate, salary_type: emp?.salary_type || '', records: 0, hours: 0, unpaid: 0, processing: 0, paid: 0 });
      const row = map.get(id);
      row.records += 1;
      row.hours += Number(a.total_hours) || 0;
      const st = a.pay_status || 'unpaid';
      if (st === 'paid') row.paid += 1; else if (st === 'processing') row.processing += 1; else row.unpaid += 1;
    }
    return Array.from(map.values()).map(r => ({ ...r, hours: Number(r.hours.toFixed(2)) })).sort((a, b) => b.unpaid - a.unpaid || b.hours - a.hours);
  }, [filteredPayments, employees]);

  const validateEmployee = () => {
    const errs = {};
    if (!empForm.full_name?.trim()) errs.full_name = 'Name is required';
    if (!empForm.email?.trim() || !/\S+@\S+\.\S+/.test(empForm.email)) errs.email = 'Valid email is required';
    if (empForm.base_rate !== '' && Number(empForm.base_rate) < 0) errs.base_rate = 'Rate cannot be negative';
    setEmpErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitEmployee = async (e) => {
    e.preventDefault();
    if (employeeSaveLock.current) return;
    if (!validateEmployee()) return;
    employeeSaveLock.current = true;
    setEmployeeSaving(true);
    const payload = {
      ...empForm,
      full_name: empForm.full_name.trim(),
      email: empForm.email.trim().toLowerCase(),
      base_rate: Number(empForm.base_rate) || 0,
      clerk_id: empForm.clerk_id?.trim() || null,
      phone: empForm.phone?.trim() || null,
    };
    try {
      let result;
      if (editingEmp) {
        result = api ? await api.employees.update(editingEmp.id, payload) : await localHrStore.employees.update(editingEmp.id, payload);
        toast.success(result?.pendingApproval ? `Employee change submitted for approval (request #${result.approvalId}).` : 'Employee updated');
      } else {
        result = api ? await api.employees.create(payload) : await localHrStore.employees.create(payload);
        toast.success(result?.pendingApproval ? `Employee creation submitted for approval (request #${result.approvalId}).` : 'Employee added');
      }
      setShowEmpForm(false); setEditingEmp(null); setEmpForm(emptyEmployee); setEmpErrors({});
      await loadEmployees(); await loadAttendance();
    } catch (err) {
      toast.error(err.message || 'Failed to save employee');
    } finally {
      employeeSaveLock.current = false;
      setEmployeeSaving(false);
    }
  };

  const validateAttendance = () => {
    const errs = {};
    if (!attForm.employee_id) errs.employee_id = 'Employee is required';
    if (!attForm.clock_in) errs.clock_in = 'Clock-in time is required';
    if (attForm.clock_in && attForm.clock_out && new Date(attForm.clock_out) < new Date(attForm.clock_in)) errs.clock_out = 'Clock-out must be after clock-in';
    setAttErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submitAttendance = async (e) => {
    e.preventDefault();
    if (attendanceSaveLock.current) return;
    if (!validateAttendance()) return;
    attendanceSaveLock.current = true;
    setAttendanceSaving(true);
    const payload = { ...attForm, employee_id: Number(attForm.employee_id), pay_status: attForm.pay_status || 'unpaid' };
    if (!payload.clock_out) payload.clock_out = null;
    try {
      let result;
      if (editingAtt) {
        result = api ? await api.attendance.update(editingAtt.id, payload) : await localHrStore.attendance.update(editingAtt.id, payload);
        toast.success(result?.pendingApproval ? `Attendance change submitted for approval (request #${result.approvalId}).` : 'Attendance updated');
      } else {
        result = api ? await api.attendance.create(payload) : await localHrStore.attendance.create(payload);
        toast.success(result?.pendingApproval ? `Attendance entry submitted for approval (request #${result.approvalId}).` : 'Attendance recorded');
      }
      setShowAttForm(false); setEditingAtt(null); setAttForm(emptyAttendance); setAttErrors({});
      await loadAttendance();
    } catch (err) {
      toast.error(err.message || 'Failed to save attendance');
    } finally {
      attendanceSaveLock.current = false;
      setAttendanceSaving(false);
    }
  };

  const submitPayroll = async (e) => {
    e.preventDefault();
    if (payrollSaveLock.current) return;
    const gross = Number(payrollForm.gross_pay);
    const deductions = Number(payrollForm.deductions) || 0;
    const totalUnits = Number(payrollForm.total_units) || 0;
    const errors = {};
    if (!payrollForm.employee_id) errors.employee_id = 'Employee is required';
    if (!payrollForm.pay_period_start) errors.pay_period_start = 'Start date is required';
    if (!payrollForm.pay_period_end) errors.pay_period_end = 'End date is required';
    if (payrollForm.pay_period_start && payrollForm.pay_period_end &&
      payrollForm.pay_period_end < payrollForm.pay_period_start) {
      errors.pay_period_end = 'End date must be on or after the start date';
    }
    if (payrollForm.gross_pay === '' || !Number.isFinite(gross) || gross < 0) errors.gross_pay = 'Enter a valid non-negative gross pay';
    if (!Number.isFinite(deductions) || deductions < 0) errors.deductions = 'Enter valid non-negative deductions';
    if (deductions > gross) errors.deductions = 'Deductions cannot exceed gross pay';
    if (!Number.isFinite(totalUnits) || totalUnits < 0) errors.total_units = 'Enter valid non-negative units';
    setPayrollErrors(errors);
    if (Object.keys(errors).length) return;

    payrollSaveLock.current = true;
    setPayrollSaving(true);
    try {
      const payload = {
        employee_id: Number(payrollForm.employee_id),
        pay_period_start: payrollForm.pay_period_start,
        pay_period_end: payrollForm.pay_period_end,
        total_units: totalUnits,
        gross_pay: gross,
        deductions,
        net_pay: Math.round((gross - deductions) * 100) / 100,
        status: payrollForm.status,
      };
      const result = api
        ? await api.payroll.create(payload)
        : await localHrStore.payroll.create(payload);
      if (result?.pendingApproval) {
        toast.success(`Payroll run submitted for approval (request #${result.approvalId}).`);
      } else {
        toast.success('Payroll run saved.');
      }
      setShowPayrollForm(false);
      setPayrollForm(emptyPayroll);
      setPayrollErrors({});
      await loadPayroll();
    } catch (err) {
      toast.error(err.message || 'Could not save payroll run.');
    } finally {
      payrollSaveLock.current = false;
      setPayrollSaving(false);
    }
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (paymentSaveLock.current) return;
    const amount = Number(paymentForm.amount);
    const amountCents = Math.round(amount * 100);
    const errors = {};
    if (!paymentForm.employee_id) errors.employee_id = 'Employee is required';
    if (paymentForm.amount === '' || !Number.isFinite(amount) || amountCents <= 0) {
      errors.amount = 'Enter a payment amount greater than zero';
    }
    if (!paymentForm.payment_date) errors.payment_date = 'Payment date is required';
    setPaymentErrors(errors);
    if (Object.keys(errors).length) return;

    paymentSaveLock.current = true;
    setPaymentSaving(true);
    try {
      const payload = {
        ...paymentForm,
        employee_id: Number(paymentForm.employee_id),
        payroll_run_id: paymentForm.payroll_run_id ? Number(paymentForm.payroll_run_id) : null,
        amount: amountCents / 100,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
      };
      await (api
        ? api.payments.create(payload)
        : localHrStore.payments.create(payload));
      toast.success('Employee payment recorded.');
      setShowPaymentForm(false);
      setPaymentForm(emptyPayment);
      setPaymentErrors({});
      await loadPayments();
    } catch (err) {
      toast.error(err.message || 'Could not record employee payment.');
    } finally {
      paymentSaveLock.current = false;
      setPaymentSaving(false);
    }
  };

  const toggleBulkEmployee = (id) => {
    setBulk(b => {
      const has = b.employee_ids.includes(id);
      return { ...b, employee_ids: has ? b.employee_ids.filter(x => x !== id) : [...b.employee_ids, id] };
    });
  };

  const submitBulk = async (e) => {
    e.preventDefault();
    if (bulkLock.current) return;
    const errs = {};
    if (!bulk.date) errs.date = 'Date is required';
    if (!bulk.clock_in_time) errs.clock_in_time = 'Clock-in time is required';
    if (!bulk.employee_ids.length) errs.employee_ids = 'Select at least one employee';
    if (bulk.clock_in_time && bulk.clock_out_time && bulk.clock_out_time <= bulk.clock_in_time) errs.clock_out_time = 'Clock-out must be after clock-in';
    setBulkErrors(errs);
    if (Object.keys(errs).length) return;
    bulkLock.current = true;
    setBulkBusy(true);
    try {
      const records = bulk.employee_ids.map(employee_id => ({
        employee_id,
        clock_in: `${bulk.date}T${bulk.clock_in_time}:00`,
        clock_out: bulk.clock_out_time ? `${bulk.date}T${bulk.clock_out_time}:00` : null,
        status: bulk.status,
        pay_status: 'unpaid',
        payment_date: null,
        payment_notes: '',
        notes: bulk.notes || null,
      }));
      const result = api ? await api.attendance.bulkCreate(records) : await localHrStore.attendance.bulkCreate(records);
      if (result?.pendingApproval) {
        toast.success(`Bulk attendance request #${result.approvalId} submitted for approval.`);
        setShowBulk(false); setBulk(emptyBulk); setBulkErrors({});
        return;
      }
      const created = result?.createdCount ?? result?.created?.length ?? 0;
      const failed = result?.errorCount ?? result?.errors?.length ?? 0;
      if (created) toast.success(`Bulk attendance added: ${created} record${created === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`);
      if (!created && failed) toast.error(`Bulk attendance failed for ${failed} record${failed === 1 ? '' : 's'}`);
      setShowBulk(false); setBulk(emptyBulk); setBulkErrors({});
      await loadAttendance();
    } catch (err) {
      toast.error(err.message || 'Bulk attendance failed');
    } finally {
      bulkLock.current = false;
      setBulkBusy(false);
    }
  };

  const quickSetPaymentInfo = async (record, patch) => {
    try {
      const result = api
        ? await api.attendance.update(record.id, patch)
        : await localHrStore.attendance.update(record.id, patch);
      if (result?.pendingApproval) {
        toast.success(`Payment change submitted for approval (request #${result.approvalId}).`);
        return;
      }
      setAttendance(items => items.map(i => i.id === record.id ? { ...i, ...patch } : i));
    } catch (e) {
      toast.error(e.message || 'Failed to update payment');
    }
  };

  const quickSetPayStatus = async (record, pay_status) => quickSetPaymentInfo(record, { pay_status });

  const toggleAttSelect = (id) => setSelectedAttIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const allFilteredAttSelected = filteredAttendance.length > 0 && filteredAttendance.every(a => selectedAttIds.includes(a.id));
  const toggleAllFilteredAtt = () => {
    if (allFilteredAttSelected) {
      const filteredIds = new Set(filteredAttendance.map(a => a.id));
      setSelectedAttIds(ids => ids.filter(id => !filteredIds.has(id)));
    } else {
      setSelectedAttIds(ids => [...new Set([...ids, ...filteredAttendance.map(a => a.id)])]);
    }
  };
  const bulkAssignPayStatus = async (scope = 'selected') => {
    const ids = scope === 'filtered' ? filteredAttendance.map(a => a.id) : selectedAttIds;
    if (!ids.length) { toast.error(scope === 'filtered' ? 'No filtered attendance records to update.' : 'Select attendance records first.'); return; }
    const label = PAY_STATUSES.find(s => s.value === bulkPayStatus)?.label || bulkPayStatus;
    const scopeLabel = scope === 'filtered' ? 'filtered' : 'selected';
    if (!window.confirm(`Set ${ids.length} ${scopeLabel} attendance record(s) to ${label}?`)) return;
    try {
      const result = api
        ? await api.attendance.bulkUpdate({ ids, pay_status: bulkPayStatus })
        : await localHrStore.attendance.bulkUpdate({ ids, pay_status: bulkPayStatus });
      toast.success(result?.pendingApproval ? `Bulk payment request #${result.approvalId} submitted for approval.` : `Updated ${ids.length} record(s) to ${label}.`);
      if (result?.pendingApproval) return;
      await loadAttendance();
      if (scope !== 'filtered') setSelectedAttIds([]);
    } catch (e) { toast.error(`Bulk pay-status update failed: ${e.message}`); }
  };

  const togglePaySelect = (id) => setSelectedPayIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const allFilteredPaySelected = filteredPayments.length > 0 && filteredPayments.every(a => selectedPayIds.includes(a.id));
  const toggleAllFilteredPay = () => {
    if (allFilteredPaySelected) {
      const filteredIds = new Set(filteredPayments.map(a => a.id));
      setSelectedPayIds(ids => ids.filter(id => !filteredIds.has(id)));
    } else {
      setSelectedPayIds(ids => [...new Set([...ids, ...filteredPayments.map(a => a.id)])]);
    }
  };
  const bulkAssignPaymentStatus = async (scope = 'selected') => {
    const ids = scope === 'filtered' ? filteredPayments.map(a => a.id) : selectedPayIds;
    if (!ids.length) { toast.error(scope === 'filtered' ? 'No filtered payment records to update.' : 'Select payment records first.'); return; }
    const label = PAY_STATUSES.find(s => s.value === payBulkStatus)?.label || payBulkStatus;
    const scopeLabel = scope === 'filtered' ? 'filtered' : 'selected';
    if (!window.confirm(`Set ${ids.length} ${scopeLabel} employee payment record(s) to ${label}${payBulkDate ? ` with payment date ${payBulkDate}` : ''}?`)) return;
    try {
      const payload = { ids, pay_status: payBulkStatus, ...(payBulkDate ? { payment_date: payBulkDate } : {}), ...(payBulkNotes ? { payment_notes: payBulkNotes } : {}) };
      const result = api
        ? await api.attendance.bulkUpdate(payload)
        : await localHrStore.attendance.bulkUpdate(payload);
      toast.success(result?.pendingApproval ? `Bulk payment request #${result.approvalId} submitted for approval.` : `Updated ${ids.length} payment record(s) to ${label}.`);
      if (result?.pendingApproval) return;
      await loadAttendance();
      if (scope !== 'filtered') setSelectedPayIds([]);
    } catch (e) { toast.error(`Payment bulk update failed: ${e.message}`); }
  };

  const onConfirmDelete = async () => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    try {
      if (confirm.kind === 'employee') {
        const result = api ? await api.employees.remove(confirm.id) : await localHrStore.employees.remove(confirm.id);
        await loadEmployees(); await loadAttendance();
        toast.success(result?.pendingApproval ? `Employee removal submitted for approval (request #${result.approvalId}).` : 'Employee deleted');
      } else if (confirm.kind === 'attendance') {
        const result = api ? await api.attendance.remove(confirm.id) : await localHrStore.attendance.remove(confirm.id);
        await loadAttendance();
        toast.success(result?.pendingApproval ? `Attendance removal submitted for approval (request #${result.approvalId}).` : 'Attendance deleted');
      } else if (confirm.kind === 'payment') {
        if (api) await api.payments.remove(confirm.id);
        else await localHrStore.payments.remove(confirm.id);
        await loadPayments();
        toast.success('Payment record deleted.');
      }
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    } finally {
      deleteLock.current = false;
      setConfirm({ open: false, kind: null, id: null });
    }
  };

  const changePrivilege = async (targetUserId, role) => {
    if (!api) return;
    try {
      await api.privileges.setRole(targetUserId, role);
      toast.success('Privilege updated');
      await loadPrivileges();
    } catch (e) {
      toast.error(e.message || 'Failed to update privilege');
    }
  };

  const linkEmployeeAccount = async (targetUserId, employeeId) => {
    if (!api || !employeeId || linkingUserId) return;
    setLinkingUserId(targetUserId);
    try {
      await api.privileges.linkEmployee(targetUserId, Number(employeeId));
      toast.success('Account linked to the employee profile.');
      await loadPrivileges();
    } catch (e) {
      toast.error(e.message || 'Could not link this account to the employee profile.');
    } finally {
      setLinkingUserId(null);
    }
  };

  const hoursPreview = calcHours(attForm.clock_in, attForm.clock_out);
  const tabs = [
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'payments', label: 'Employee Payments', icon: DollarSign },
    { id: 'payroll', label: 'Payroll Runs', icon: DollarSign },
    { id: 'oversight', label: 'Approvals & Audit', icon: CheckCircle2 },
    ...(canManagePrivileges ? [{ id: 'privileges', label: 'User Privileges', icon: Shield }] : []),
  ];

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-72" />
          <div className="h-64 bg-slate-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-1">HR &amp; Staff Management</h1>
              <p className="text-slate-600">Manage employees, attendance, payroll runs, and the ledger of actual employee payments.</p>
              {api && Object.values(loadErrors).some(Boolean) && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
                  Database data could not be loaded: {Object.entries(loadErrors).filter(([, error]) => error).map(([name, error]) => `${name}: ${error}`).join('; ')}
                </p>
              )}
              {!clerkConfigured && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-2 inline-block">
                  Local mode: this browser stores its own data. Configure Clerk and the Neon API for shared database storage; apply migrations through <code>008_employee_payments.sql</code>.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              {tab === 'employees' && (
                <button onClick={() => { setEditingEmp(null); setEmpForm(emptyEmployee); setEmpErrors({}); setShowEmpForm(true); }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm touch-manipulation">
                  <Plus className="w-4 h-4" /> Add Employee
                </button>
              )}
              {tab === 'attendance' && (
                <>
                  <button onClick={() => { setBulk(emptyBulk); setBulkErrors({}); setShowBulk(true); }}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 font-medium text-sm touch-manipulation">
                    <Layers className="w-4 h-4" /> Bulk Attendance
                  </button>
                  <button onClick={() => { setEditingAtt(null); setAttForm(emptyAttendance); setAttErrors({}); setShowAttForm(true); }}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm touch-manipulation">
                    <Plus className="w-4 h-4" /> Log Attendance
                  </button>
                </>
              )}
              {tab === 'payroll' && (
                <button onClick={() => { setPayrollForm({ ...emptyPayroll, employee_id: employees[0] ? String(employees[0].id) : '' }); setPayrollErrors({}); setShowPayrollForm(true); }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm touch-manipulation">
                  <Plus className="w-4 h-4" /> Add Payroll Run
                </button>
              )}
              {tab === 'payments' && (
                <button onClick={() => { setPaymentForm({ ...emptyPayment, employee_id: employees[0] ? String(employees[0].id) : '' }); setPaymentErrors({}); setShowPaymentForm(true); }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm touch-manipulation">
                  <Plus className="w-4 h-4" /> Record Payment
                </button>
              )}
            </div>
          </div>
        </motion.div>

        <div className="flex gap-2 -mx-1 px-1 overflow-x-auto pb-1 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}>
              <t.icon className="w-4 h-4" />{t.label}
            </button>
          ))}
        </div>

        {tab === 'employees' && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
            <CardHeader className="pb-3">
              <div className="space-y-3">
                <CardTitle className="text-lg flex items-center gap-2"><Briefcase className="w-5 h-5 text-blue-600" />Employees</CardTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
                  <label className="block xl:col-span-2"><span className="text-xs font-medium text-slate-600">Search employees</span><input value={empFilters.q} onChange={e => setEmpFilters(f => ({ ...f, q: e.target.value }))} className={`${inputCls()} mt-1`} placeholder="Name, email, phone, Clerk ID..." /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Employment type</span><select value={empFilters.employment_type} onChange={e => setEmpFilters(f => ({ ...f, employment_type: e.target.value }))} className={`${selectCls()} mt-1`}>{EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Status</span><select value={empFilters.status} onChange={e => setEmpFilters(f => ({ ...f, status: e.target.value }))} className={`${selectCls()} mt-1`}><option value="">All statuses</option>{EMPLOYEE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Pay type</span><select value={empFilters.salary_type} onChange={e => setEmpFilters(f => ({ ...f, salary_type: e.target.value }))} className={`${selectCls()} mt-1`}><option value="">All pay types</option>{SALARY_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Sort</span><select value={empFilters.sort} onChange={e => setEmpFilters(f => ({ ...f, sort: e.target.value }))} className={`${selectCls()} mt-1`}><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="rate_desc">Highest rate</option><option value="rate_asc">Lowest rate</option><option value="hire_desc">Newest hire</option><option value="hire_asc">Oldest hire</option></select></label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-slate-600">Showing <span className="font-semibold text-slate-900">{filteredEmployees.length}</span> of {employees.length} employees</span><button type="button" onClick={() => setEmpFilters({ q: '', status: '', employment_type: '', salary_type: '', sort: 'name_asc' })} className="text-blue-600 hover:text-blue-700 font-medium">Clear employee filters</button></div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                <table className="w-full text-sm min-w-[640px] sm:min-w-[760px]">
                  <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Email</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Pay</th><th className="py-2 pr-3 font-medium">Rate</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium text-right">Actions</th></tr></thead>
                  <tbody>
                    {paginate(filteredEmployees, 'employees').items.map(emp => (
                      <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pr-3 font-medium text-slate-900">{emp.full_name}<div className="text-xs font-normal text-slate-500">Added by: {addedBy(emp)}</div></td>
                        <td className="py-3 pr-3 text-slate-600">{emp.email}</td>
                        <td className="py-3 pr-3 text-slate-600">{String(emp.employment_type || '').replace('_', ' ')}</td>
                        <td className="py-3 pr-3 text-slate-600">{String(emp.salary_type || '').replace(/_/g, ' ')}</td>
                        <td className="py-3 pr-3 text-slate-700">{fmtMoney(emp.base_rate)}</td>
                        <td className="py-3 pr-3"><StatusBadge value={emp.status} /></td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingEmp(emp); setEmpForm({ ...emptyEmployee, ...emp, base_rate: emp.base_rate ?? '', hire_date: emp.hire_date ? String(emp.hire_date).slice(0, 10) : emptyEmployee.hire_date }); setEmpErrors({}); setShowEmpForm(true); }} className={iconBtnCls('blue')} aria-label="Edit employee"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => setConfirm({ open: true, kind: 'employee', id: emp.id })} className={iconBtnCls('red')} aria-label="Delete employee"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                    {filteredEmployees.length === 0 && employees.length > 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-500">No employees match the current filters.</td></tr>}
                    {employees.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-500">No employees found. Add your first staff member.</td></tr>}
                  </tbody>
                </table>
                <Pager meta={paginate(filteredEmployees, 'employees')} onPage={(p) => setPage('employees', p)} />
              </div>
            </CardContent>
          </Card>
        )}

        {tab === 'attendance' && (
          <div className="space-y-4">
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><Filter className="w-5 h-5 text-blue-600" />Attendance Filters</CardTitle><p className="text-sm text-slate-500">Attendance only. Payment status and payment dates are managed in Employee Payments (payment may happen days/months after attendance).</p></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="block"><span className="text-xs font-medium text-slate-600">Employee</span><select value={attFilters.employee_id} onChange={e => setAttFilters(f => ({ ...f, employee_id: e.target.value }))} className={selectCls()}><option value="">All employees</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">From date</span><input type="date" value={attFilters.date_from} onChange={e => setAttFilters(f => ({ ...f, date_from: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">To date</span><input type="date" value={attFilters.date_to} onChange={e => setAttFilters(f => ({ ...f, date_to: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Sort</span><select value={attFilters.sort} onChange={e => setAttFilters(f => ({ ...f, sort: e.target.value }))} className={selectCls()}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Attendance status</span><select value={attFilters.status} onChange={e => setAttFilters(f => ({ ...f, status: e.target.value }))} className={selectCls()}><option value="">All statuses</option>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
                  <label className="block sm:col-span-2 lg:col-span-3"><span className="text-xs font-medium text-slate-600">Search (name/notes)</span><div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={attFilters.q} onChange={e => setAttFilters(f => ({ ...f, q: e.target.value }))} className={`${inputCls()} pl-9`} placeholder="Search employee or notes..." /></div></label>
                </div>
                <div className="flex flex-wrap gap-2 pt-1"><SummaryChip icon={CalendarDays} label="Records" value={attendanceSummary.records} /><SummaryChip icon={Clock} label="Hours" value={attendanceSummary.hours} /><button type="button" onClick={() => setAttFilters({ employee_id: '', date_from: '', date_to: '', status: '', sort: 'desc', q: '' })} className="ml-auto text-sm text-blue-600 hover:text-blue-700 font-medium">Clear filters</button></div>
              </CardContent>
            </Card>
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Clock className="w-5 h-5 text-blue-600" />Attendance Log</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                  <table className="w-full text-sm min-w-[720px] sm:min-w-[860px]">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 pr-3 font-medium">Employee</th><th className="py-2 pr-3 font-medium">Clock In</th><th className="py-2 pr-3 font-medium">Clock Out</th><th className="py-2 pr-3 font-medium">Hours</th><th className="py-2 pr-3 font-medium">Attendance Status</th><th className="py-2 pr-3 font-medium">Notes</th><th className="py-2 font-medium text-right">Actions</th></tr></thead>
                    <tbody>
                      {paginate(filteredAttendance, 'attendance').items.map(a => (
                        <tr key={a.id} className="border-b border-slate-100 last:border-0 align-top">
                          <td className="py-3 pr-3 font-medium text-slate-900">{a.employee_name || a.employee_id}<div className="text-xs font-normal text-slate-500">Added by: {addedBy(a)}</div></td>
                          <td className="py-3 pr-3 text-slate-600 whitespace-nowrap">{a.clock_in ? format(new Date(a.clock_in), 'MMM d, yyyy HH:mm') : '—'}</td>
                          <td className="py-3 pr-3 text-slate-600 whitespace-nowrap">{a.clock_out ? format(new Date(a.clock_out), 'MMM d, yyyy HH:mm') : '—'}</td>
                          <td className="py-3 pr-3 text-slate-700">{a.total_hours != null ? `${a.total_hours}h` : '—'}</td>
                          <td className="py-3 pr-3"><StatusBadge value={a.status} /></td>
                          <td className="py-3 pr-3 text-slate-500 max-w-[240px]"><div className="truncate" title={a.notes || ''}>{a.notes || '—'}</div></td>
                          <td className="py-3 text-right whitespace-nowrap">
                            <button onClick={() => { setEditingAtt(a); setAttForm({ employee_id: String(a.employee_id), clock_in: toLocalInput(a.clock_in), clock_out: toLocalInput(a.clock_out), status: a.status || 'present', pay_status: a.pay_status || 'unpaid', payment_date: a.payment_date ? String(a.payment_date).slice(0,10) : '', payment_notes: a.payment_notes || '', notes: a.notes || '' }); setAttErrors({}); setShowAttForm(true); }} className={iconBtnCls('blue')} aria-label="Edit attendance"><Edit className="w-4 h-4" /></button>
                            <button onClick={() => setConfirm({ open: true, kind: 'attendance', id: a.id })} className={iconBtnCls('red')} aria-label="Delete attendance"><Trash2 className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      ))}
                      {filteredAttendance.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-500">No attendance records match the current filters.</td></tr>}
                    </tbody>
                  </table>
                  <Pager meta={paginate(filteredAttendance, 'attendance')} onPage={(p) => setPage('attendance', p)} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'payments' && (
          <div className="space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5 text-blue-600" />Employee Payment Ledger</CardTitle>
                <p className="text-sm text-slate-500">Record each actual payment made to an employee, including partial payments. A payment can optionally be linked to a payroll run. These are stored separately from attendance payment statuses.</p>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap gap-2">
                  <SummaryChip icon={CalendarDays} label="Payments" value={employeePayments.length} />
                  <SummaryChip icon={DollarSign} label="Total paid" value={fmtMoney(employeePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0))} />
                </div>
                {paymentsError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Could not load payment records: {paymentsError}. Apply database migration <code>008_employee_payments.sql</code> if it has not been run.</p>}
                {paymentsLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading payments…</p> : (
                  <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-3 font-medium">Employee</th><th className="py-2 pr-3 font-medium">Payment date</th>
                        <th className="py-2 pr-3 font-medium">Amount</th><th className="py-2 pr-3 font-medium">Method</th>
                        <th className="py-2 pr-3 font-medium">Payroll period</th><th className="py-2 pr-3 font-medium">Reference / note</th>
                        <th className="py-2 pr-3 font-medium">Recorded by</th><th className="py-2 font-medium text-right">Actions</th>
                      </tr></thead>
                      <tbody>
                        {paginate(employeePayments, 'ledgerPayments').items.map(payment => (
                          <tr key={payment.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-3 pr-3 font-medium text-slate-900">{payment.employee_name || 'Unknown employee'}</td>
                            <td className="py-3 pr-3 text-slate-600 whitespace-nowrap">{payment.payment_date}</td>
                            <td className="py-3 pr-3 font-medium text-slate-900">{fmtMoney(payment.amount)}</td>
                            <td className="py-3 pr-3 text-slate-600">{String(payment.payment_method || 'other').replace(/_/g, ' ')}</td>
                            <td className="py-3 pr-3 text-slate-600">{payment.pay_period_start ? `${payment.pay_period_start} – ${payment.pay_period_end}` : 'Not linked'}</td>
                            <td className="py-3 pr-3 text-slate-600">{[payment.reference, payment.notes].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="py-3 pr-3 text-slate-500">{addedBy(payment)}</td>
                            <td className="py-3 text-right"><button type="button" onClick={() => setConfirm({ open: true, kind: 'payment', id: payment.id })} className={iconBtnCls('red')} aria-label="Delete payment record"><Trash2 className="w-4 h-4" /></button></td>
                          </tr>
                        ))}
                        {employeePayments.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-500">No actual payments have been recorded yet. Select “Record Payment” to add one.</td></tr>}
                      </tbody>
                    </table>
                    <Pager meta={paginate(employeePayments, 'ledgerPayments')} onPage={page => setPage('ledgerPayments', page)} />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader className="pb-3"><CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5 text-blue-600" />Attendance Payment Status</CardTitle><p className="text-sm text-slate-500">Optional per-attendance unpaid/processing/paid status. Use the Employee Payment Ledger above to record actual amounts paid.</p></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="block"><span className="text-xs font-medium text-slate-600">Employee</span><select value={payFilters.employee_id} onChange={e => setPayFilters(f => ({ ...f, employee_id: e.target.value }))} className={selectCls()}><option value="">All employees</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Employment type</span><select value={payFilters.employment_type} onChange={e => setPayFilters(f => ({ ...f, employment_type: e.target.value }))} className={selectCls()}>{EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Attendance date from</span><input type="date" value={payFilters.date_from} onChange={e => setPayFilters(f => ({ ...f, date_from: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Attendance date to</span><input type="date" value={payFilters.date_to} onChange={e => setPayFilters(f => ({ ...f, date_to: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Clock-in time from</span><input type="time" value={payFilters.time_from} onChange={e => setPayFilters(f => ({ ...f, time_from: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Clock-in time to</span><input type="time" value={payFilters.time_to} onChange={e => setPayFilters(f => ({ ...f, time_to: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Payment date from</span><input type="date" value={payFilters.payment_date_from} onChange={e => setPayFilters(f => ({ ...f, payment_date_from: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Payment date to</span><input type="date" value={payFilters.payment_date_to} onChange={e => setPayFilters(f => ({ ...f, payment_date_to: e.target.value }))} className={inputCls()} /></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Attendance status</span><select value={payFilters.status} onChange={e => setPayFilters(f => ({ ...f, status: e.target.value }))} className={selectCls()}><option value="">All statuses</option>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Pay status</span><select value={payFilters.pay_status} onChange={e => setPayFilters(f => ({ ...f, pay_status: e.target.value }))} className={selectCls()}><option value="">All pay statuses</option>{PAY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Sort</span><select value={payFilters.sort} onChange={e => setPayFilters(f => ({ ...f, sort: e.target.value }))} className={selectCls()}><option value="date_desc">Newest attendance</option><option value="date_asc">Oldest attendance</option><option value="payment_date_desc">Newest payment date</option><option value="payment_date_asc">Oldest payment date</option><option value="employee_asc">Employee A–Z</option><option value="employee_desc">Employee Z–A</option><option value="hours_desc">Most hours</option><option value="hours_asc">Least hours</option><option value="pay_status">Pay status</option></select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Search</span><div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={payFilters.q} onChange={e => setPayFilters(f => ({ ...f, q: e.target.value }))} className={`${inputCls()} pl-9`} placeholder="Employee, notes, status..." /></div></label>
                </div>
                <div className="flex flex-wrap gap-2"><SummaryChip icon={CalendarDays} label="Records" value={paymentSummary.records} /><SummaryChip icon={Users} label="Employees" value={paymentSummary.employees} /><SummaryChip icon={Clock} label="Hours" value={paymentSummary.hours} /><SummaryChip icon={AlertCircle} label="Unpaid" value={paymentSummary.unpaid} tone="amber" /><SummaryChip icon={Clock} label="Processing" value={paymentSummary.processing} tone="slate" /><SummaryChip icon={CheckCircle2} label="Paid" value={paymentSummary.paid} tone="emerald" /><button type="button" onClick={() => { setSelectedPayIds([]); setPayFilters({ employee_id: '', date_from: '', date_to: '', time_from: '', time_to: '', status: '', pay_status: '', employment_type: '', payment_date_from: '', payment_date_to: '', sort: 'date_desc', q: '' }); }} className="ml-auto text-sm text-blue-600 hover:text-blue-700 font-medium">Clear filters</button></div>
                <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                  <span className="text-sm text-slate-600 pb-2"><span className="font-semibold text-slate-900">{selectedPayIds.length}</span> selected of {filteredPayments.length} filtered</span>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Pay status</span><select value={payBulkStatus} onChange={e => setPayBulkStatus(e.target.value)} className={`${selectCls()} min-w-[150px]`}>{PAY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-medium text-slate-600">Payment date</span><input type="date" value={payBulkDate} onChange={e => setPayBulkDate(e.target.value)} className={inputCls()} /></label>
                  <label className="block min-w-[180px] flex-1"><span className="text-xs font-medium text-slate-600">Payment note (optional)</span><input value={payBulkNotes} onChange={e => setPayBulkNotes(e.target.value)} className={inputCls()} placeholder="e.g. paid by transfer" /></label>
                  <button type="button" onClick={() => bulkAssignPaymentStatus('selected')} disabled={!selectedPayIds.length} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Apply to selected</button>
                  <button type="button" onClick={() => bulkAssignPaymentStatus('filtered')} disabled={!filteredPayments.length} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Apply to filtered</button>
                  <button type="button" onClick={() => setSelectedPayIds([])} disabled={!selectedPayIds.length} className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50">Clear selection</button>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader className="pb-2"><CardTitle className="text-base">Employee Payment Summary (filtered)</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {paginate(paymentEmployeeRows, 'paymentSummary').items.map(r => (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-medium text-slate-900 truncate">{r.name}</div><div className="text-xs text-slate-500">{String(r.employment_type || '—').replace('_', ' ')} · {String(r.salary_type || '').replace(/_/g, ' ') || 'rate'} {r.rate != null ? `· ${fmtMoney(r.rate)}` : ''}</div></div><button type="button" onClick={() => setPayFilters(f => ({ ...f, employee_id: String(r.id) }))} className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">Filter</button></div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span className="text-slate-700">{r.records} records</span><span className="text-slate-700">{r.hours}h</span><span className="text-amber-700">Unpaid {r.unpaid}</span><span className="text-slate-600">Processing {r.processing}</span><span className="text-emerald-700">Paid {r.paid}</span></div>
                    </div>
                  ))}
                  {paymentEmployeeRows.length === 0 && <p className="text-sm text-slate-500">No employee payment records match the current filters.</p>}
                </div>
                <Pager meta={paginate(paymentEmployeeRows, 'paymentSummary')} onPage={(p) => setPage('paymentSummary', p)} />
              </CardContent>
            </Card>
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CalendarDays className="w-5 h-5 text-blue-600" />Payment Records</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                  <table className="w-full text-sm min-w-[1180px]">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 pr-3 font-medium w-10"><input type="checkbox" checked={allFilteredPaySelected} onChange={toggleAllFilteredPay} aria-label="Select all filtered payment records" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th><th className="py-2 pr-3 font-medium">Employee</th><th className="py-2 pr-3 font-medium">Attendance Date/Time</th><th className="py-2 pr-3 font-medium">Payment Date</th><th className="py-2 pr-3 font-medium">Hours</th><th className="py-2 pr-3 font-medium">Attendance</th><th className="py-2 pr-3 font-medium">Pay Status</th><th className="py-2 pr-3 font-medium">Notes</th><th className="py-2 font-medium text-right">Actions</th></tr></thead>
                    <tbody>
                      {paginate(filteredPayments, 'payments').items.map(a => (
                        <tr key={a.id} className={`border-b border-slate-100 last:border-0 align-top ${selectedPayIds.includes(a.id) ? 'bg-blue-50/40' : ''}`}>
                          <td className="py-3 pr-3"><input type="checkbox" checked={selectedPayIds.includes(a.id)} onChange={() => togglePaySelect(a.id)} aria-label={`Select payment record ${a.id}`} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                          <td className="py-3 pr-3 font-medium text-slate-900">{a.employee_name || a.employee_id}<div className="text-xs font-normal text-slate-500">Added by: {addedBy(a)}</div></td>
                          <td className="py-3 pr-3 text-slate-600 whitespace-nowrap"><div>{a.clock_in ? format(new Date(a.clock_in), 'MMM d, yyyy') : '—'}</div><div className="text-xs text-slate-500">{a.clock_in ? format(new Date(a.clock_in), 'HH:mm') : '—'}{a.clock_out ? ` – ${format(new Date(a.clock_out), 'HH:mm')}` : ''}</div></td>
                          <td className="py-3 pr-3"><input type="date" value={a.payment_date ? String(a.payment_date).slice(0,10) : ''} onChange={e => quickSetPaymentInfo(a, { payment_date: e.target.value || null })} className="px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white" aria-label={`Payment date for ${a.employee_name || a.id}`} /></td>
                          <td className="py-3 pr-3 text-slate-700">{a.total_hours != null ? `${a.total_hours}h` : '—'}</td>
                          <td className="py-3 pr-3"><StatusBadge value={a.status} /></td>
                          <td className="py-3 pr-3"><select value={a.pay_status || 'unpaid'} onChange={e => quickSetPaymentInfo(a, { pay_status: e.target.value, ...(e.target.value !== 'unpaid' && !a.payment_date ? { payment_date: format(new Date(), 'yyyy-MM-dd') } : {}) })} className="px-2 py-1 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">{PAY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></td>
                          <td className="py-3 pr-3 text-slate-500 max-w-[220px]"><div className="truncate" title={[a.payment_notes, a.notes].filter(Boolean).join(' | ')}>{a.payment_notes || a.notes || '—'}</div></td>
                          <td className="py-3 text-right whitespace-nowrap"><button onClick={() => { setEditingAtt(a); setAttForm({ employee_id: String(a.employee_id), clock_in: toLocalInput(a.clock_in), clock_out: toLocalInput(a.clock_out), status: a.status || 'present', pay_status: a.pay_status || 'unpaid', payment_date: a.payment_date ? String(a.payment_date).slice(0,10) : '', payment_notes: a.payment_notes || '', notes: a.notes || '' }); setAttErrors({}); setShowAttForm(true); }} className={iconBtnCls('blue')} aria-label="Edit payment record"><Edit className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                      {filteredPayments.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-500">No employee payment records match the current filters.</td></tr>}
                    </tbody>
                  </table>
                  <Pager meta={paginate(filteredPayments, 'payments')} onPage={(p) => setPage('payments', p)} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'payroll' && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5 text-blue-600" />Payroll Runs</CardTitle>
              <p className="text-sm text-slate-500">Record each employee’s pay for a date range. Enter gross pay and deductions; net pay is calculated here. Attendance payment status is tracked separately in Employee Payments.</p>
            </CardHeader>
            <CardContent>
              {payrollError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Could not load payroll runs: {payrollError}</p>}
              {payrollLoading ? <p className="py-8 text-center text-sm text-slate-500">Loading payroll runs…</p> : (
                <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3 font-medium">Employee</th>
                      <th className="py-2 pr-3 font-medium">Pay period</th>
                      <th className="py-2 pr-3 font-medium">Units</th>
                      <th className="py-2 pr-3 font-medium">Gross</th>
                      <th className="py-2 pr-3 font-medium">Deductions</th>
                      <th className="py-2 pr-3 font-medium">Net pay</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium">Added by</th>
                    </tr></thead>
                    <tbody>
                      {paginate(payrollRuns, 'payroll').items.map(run => (
                        <tr key={run.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-3 pr-3 font-medium text-slate-900">{run.employee_name || employees.find(employee => String(employee.id) === String(run.employee_id))?.full_name || 'Unknown employee'}</td>
                          <td className="py-3 pr-3 text-slate-600 whitespace-nowrap">{run.pay_period_start} – {run.pay_period_end}</td>
                          <td className="py-3 pr-3 text-slate-600">{Number(run.total_units || 0)}</td>
                          <td className="py-3 pr-3 text-slate-700">{fmtMoney(run.gross_pay)}</td>
                          <td className="py-3 pr-3 text-slate-700">{fmtMoney(run.deductions)}</td>
                          <td className="py-3 pr-3 font-medium text-slate-900">{fmtMoney(run.net_pay)}</td>
                          <td className="py-3 pr-3"><StatusBadge value={run.status} /></td>
                          <td className="py-3 text-slate-500">{addedBy(run)}</td>
                        </tr>
                      ))}
                      {payrollRuns.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-500">No payroll runs have been recorded yet. Select “Add Payroll Run” to record one.</td></tr>}
                    </tbody>
                  </table>
                  <Pager meta={paginate(payrollRuns, 'payroll')} onPage={page => setPage('payroll', page)} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === 'oversight' && <OversightPanel api={api} />}

        {tab === 'privileges' && canManagePrivileges && (
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Shield className="w-5 h-5 text-blue-600" />User Privileges</CardTitle>
              <p className="text-sm text-slate-500">Owner-only. Manage roles and link an existing account to its employee profile—no duplicate employee record is needed.</p>
            </CardHeader>
            <CardContent>
              {!clerkConfigured ? (<p className="text-sm text-slate-600">Clerk is not configured. Set <code className="bg-slate-100 px-1 rounded">VITE_CLERK_PUBLISHABLE_KEY</code> and deploy API routes to manage privileges.</p>) : privLoading ? <p className="text-sm text-slate-500">Loading users...</p> : (
                <div className="overflow-x-auto -mx-3 px-3 sm:-mx-2 sm:px-2">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 pr-3 font-medium">User</th><th className="py-2 pr-3 font-medium">Email</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Employee profile</th><th className="py-2 font-medium">Change role</th></tr></thead>
                    <tbody>
                      {paginate(privUsers, 'privileges').items.map(u => (
                        <tr key={u.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-3 pr-3 font-medium text-slate-900">{u.name}</td>
                          <td className="py-3 pr-3 text-slate-600">{u.email || '—'}</td>
                          <td className="py-3 pr-3"><span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">{ROLE_LABELS[u.role] || u.role}</span></td>
                          <td className="py-3 pr-3">
                            <select
                              value={u.employeeId || ''}
                              disabled={linkingUserId === u.id || Boolean(u.employeeId)}
                              onChange={e => linkEmployeeAccount(u.id, e.target.value)}
                              aria-label={`Link ${u.name} to an employee profile`}
                              className="w-full min-w-56 px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                            >
                              <option value="">{u.employeeId ? u.employeeName || 'Linked' : 'Select employee profile'}</option>
                              {linkableEmployees
                                .filter(employee => !employee.clerk_id || employee.clerk_id === u.id)
                                .map(employee => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.email}</option>)}
                            </select>
                            {linkingUserId === u.id && <span className="mt-1 block text-xs text-slate-500">Linking…</span>}
                          </td>
                          <td className="py-3">
                            <select value={u.role} onChange={e => changePrivilege(u.id, e.target.value)} className="px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                              <option value={ROLES.EMPLOYEE}>Employee</option>
                              <option value={ROLES.ADMIN}>Administrator</option>
                              <option value={ROLES.OWNER}>Owner</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                      {privUsers.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No users found.</td></tr>}
                    </tbody>
                  </table>
                  <Pager meta={paginate(privUsers, 'privileges')} onPage={(p) => setPage('privileges', p)} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showEmpForm && (
          <ModalShell title={editingEmp ? 'Edit Employee' : 'Add Employee'} onClose={() => !employeeSaving && setShowEmpForm(false)}>
            <form onSubmit={submitEmployee} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Full name *" error={empErrors.full_name}><input value={empForm.full_name} onChange={e => setEmpForm({ ...empForm, full_name: e.target.value })} className={inputCls(empErrors.full_name)} /></Field>
                <Field label="Email *" error={empErrors.email}><input type="email" value={empForm.email} onChange={e => setEmpForm({ ...empForm, email: e.target.value })} className={inputCls(empErrors.email)} /></Field>
                <Field label="Phone"><input value={empForm.phone || ''} onChange={e => setEmpForm({ ...empForm, phone: e.target.value })} className={inputCls()} /></Field>
                <Field label="Clerk User ID"><input value={empForm.clerk_id || ''} onChange={e => setEmpForm({ ...empForm, clerk_id: e.target.value })} className={inputCls()} placeholder="Optional" /></Field>
                <Field label="Employment type"><select value={empForm.employment_type} onChange={e => setEmpForm({ ...empForm, employment_type: e.target.value })} className={selectCls()}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="temporary">Temporary</option></select></Field>
                <Field label="Salary/wage type"><select value={empForm.salary_type} onChange={e => setEmpForm({ ...empForm, salary_type: e.target.value })} className={selectCls()}>{SALARY_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
                <Field label="Base rate" error={empErrors.base_rate}><input type="number" min="0" step="0.01" value={empForm.base_rate} onChange={e => setEmpForm({ ...empForm, base_rate: e.target.value })} className={inputCls(empErrors.base_rate)} /></Field>
                <Field label="Hire date"><input type="date" value={empForm.hire_date || ''} onChange={e => setEmpForm({ ...empForm, hire_date: e.target.value })} className={inputCls()} /></Field>
                <Field label="Status"><select value={empForm.status} onChange={e => setEmpForm({ ...empForm, status: e.target.value })} className={selectCls()}>{EMPLOYEE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
              </div>
              <ModalActions onCancel={() => setShowEmpForm(false)} submitLabel={employeeSaving ? 'Saving...' : `${editingEmp ? 'Update' : 'Create'} Employee`} disabled={employeeSaving} />
            </form>
          </ModalShell>
        )}

        {showAttForm && (
          <ModalShell title={editingAtt ? 'Edit Attendance / Payment' : 'Log Attendance'} onClose={() => !attendanceSaving && setShowAttForm(false)}>
            <form onSubmit={submitAttendance} className="space-y-4">
              <Field label="Employee *" error={attErrors.employee_id}><select value={attForm.employee_id} onChange={e => setAttForm({ ...attForm, employee_id: e.target.value })} className={selectCls(attErrors.employee_id)}><option value="">Select employee</option>{employees.filter(e => e.status === 'active' || String(e.id) === String(attForm.employee_id)).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Clock in *" error={attErrors.clock_in}><input type="datetime-local" value={attForm.clock_in} onChange={e => setAttForm({ ...attForm, clock_in: e.target.value })} className={inputCls(attErrors.clock_in)} /></Field>
                <Field label="Clock out" error={attErrors.clock_out}><input type="datetime-local" value={attForm.clock_out} onChange={e => setAttForm({ ...attForm, clock_out: e.target.value })} className={inputCls(attErrors.clock_out)} /></Field>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm"><span className="text-slate-600">Calculated hours: </span><span className="font-semibold text-slate-900">{hoursPreview != null ? `${hoursPreview} hours` : '— (set clock-out to calculate)'}</span></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Attendance status"><select value={attForm.status} onChange={e => setAttForm({ ...attForm, status: e.target.value })} className={selectCls()}>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
                <Field label="Pay status"><select value={attForm.pay_status || 'unpaid'} onChange={e => setAttForm({ ...attForm, pay_status: e.target.value, ...(e.target.value !== 'unpaid' && !attForm.payment_date ? { payment_date: format(new Date(), 'yyyy-MM-dd') } : {}) })} className={selectCls()}>{PAY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
                <Field label="Payment date"><input type="date" value={attForm.payment_date || ''} onChange={e => setAttForm({ ...attForm, payment_date: e.target.value })} className={inputCls()} /></Field>
                <Field label="Payment note"><input value={attForm.payment_notes || ''} onChange={e => setAttForm({ ...attForm, payment_notes: e.target.value })} className={inputCls()} placeholder="Optional payment reference/note" /></Field>
              </div>
              <Field label="Attendance notes"><textarea value={attForm.notes || ''} onChange={e => setAttForm({ ...attForm, notes: e.target.value })} rows={2} className={inputCls()} /></Field>
              <ModalActions onCancel={() => setShowAttForm(false)} submitLabel={attendanceSaving ? 'Saving...' : `${editingAtt ? 'Update' : 'Save'} Record`} disabled={attendanceSaving} />
            </form>
          </ModalShell>
        )}

        {showPayrollForm && (
          <ModalShell title="Add Payroll Run" onClose={() => !payrollSaving && setShowPayrollForm(false)}>
            <form onSubmit={submitPayroll} className="space-y-4">
              <p className="text-sm text-slate-600">This creates a payroll record for one employee and pay period. It does not change attendance payment statuses.</p>
              <Field label="Employee *" error={payrollErrors.employee_id}>
                <select value={payrollForm.employee_id} onChange={e => setPayrollForm({ ...payrollForm, employee_id: e.target.value })} className={selectCls(payrollErrors.employee_id)}>
                  <option value="">Select employee</option>
                  {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Pay period start *" error={payrollErrors.pay_period_start}><input type="date" value={payrollForm.pay_period_start} onChange={e => setPayrollForm({ ...payrollForm, pay_period_start: e.target.value })} className={inputCls(payrollErrors.pay_period_start)} /></Field>
                <Field label="Pay period end *" error={payrollErrors.pay_period_end}><input type="date" value={payrollForm.pay_period_end} onChange={e => setPayrollForm({ ...payrollForm, pay_period_end: e.target.value })} className={inputCls(payrollErrors.pay_period_end)} /></Field>
                <Field label="Units (hours/services)" error={payrollErrors.total_units}><input type="number" min="0" step="0.01" value={payrollForm.total_units} onChange={e => setPayrollForm({ ...payrollForm, total_units: e.target.value })} className={inputCls(payrollErrors.total_units)} /></Field>
                <Field label="Gross pay *" error={payrollErrors.gross_pay}><input type="number" min="0" step="0.01" value={payrollForm.gross_pay} onChange={e => setPayrollForm({ ...payrollForm, gross_pay: e.target.value })} className={inputCls(payrollErrors.gross_pay)} /></Field>
                <Field label="Deductions" error={payrollErrors.deductions}><input type="number" min="0" step="0.01" value={payrollForm.deductions} onChange={e => setPayrollForm({ ...payrollForm, deductions: e.target.value })} className={inputCls(payrollErrors.deductions)} /></Field>
                <Field label="Status"><select value={payrollForm.status} onChange={e => setPayrollForm({ ...payrollForm, status: e.target.value })} className={selectCls()}><option value="draft">Draft</option><option value="approved">Approved</option><option value="paid">Paid</option><option value="void">Void</option></select></Field>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <span className="text-slate-600">Net pay: </span>
                <span className="font-semibold text-slate-900">{fmtMoney(Math.round(((Number(payrollForm.gross_pay) || 0) - (Number(payrollForm.deductions) || 0)) * 100) / 100)}</span>
              </div>
              <ModalActions onCancel={() => setShowPayrollForm(false)} submitLabel={payrollSaving ? 'Saving...' : 'Save Payroll Run'} disabled={payrollSaving} />
            </form>
          </ModalShell>
        )}

        {showPaymentForm && (
          <ModalShell title="Record Employee Payment" onClose={() => !paymentSaving && setShowPaymentForm(false)}>
            <form onSubmit={submitPayment} className="space-y-4">
              <p className="text-sm text-slate-600">Record money actually paid. You can enter multiple payments for the same payroll run to track installments.</p>
              <Field label="Employee *" error={paymentErrors.employee_id}>
                <select
                  value={paymentForm.employee_id}
                  onChange={event => setPaymentForm({ ...paymentForm, employee_id: event.target.value, payroll_run_id: '' })}
                  className={selectCls(paymentErrors.employee_id)}
                >
                  <option value="">Select employee</option>
                  {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
              </Field>
              <Field label="Related payroll run (optional)">
                <select value={paymentForm.payroll_run_id} onChange={event => setPaymentForm({ ...paymentForm, payroll_run_id: event.target.value })} className={selectCls()}>
                  <option value="">Not linked to a payroll run</option>
                  {payrollRuns.filter(run => String(run.employee_id) === String(paymentForm.employee_id)).map(run => (
                    <option key={run.id} value={run.id}>{run.pay_period_start} – {run.pay_period_end} · Net {fmtMoney(run.net_pay)}</option>
                  ))}
                </select>
                {!payrollRuns.some(run => String(run.employee_id) === String(paymentForm.employee_id)) && (
                  <span className="mt-1 block text-xs text-slate-500">No payroll run exists for this employee yet; you can still record an unlinked payment.</span>
                )}
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Amount *" error={paymentErrors.amount}><input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={event => setPaymentForm({ ...paymentForm, amount: event.target.value })} className={inputCls(paymentErrors.amount)} /></Field>
                <Field label="Payment date *" error={paymentErrors.payment_date}><input type="date" value={paymentForm.payment_date} onChange={event => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} className={inputCls(paymentErrors.payment_date)} /></Field>
                <Field label="Payment method">
                  <select value={paymentForm.payment_method} onChange={event => setPaymentForm({ ...paymentForm, payment_method: event.target.value })} className={selectCls()}>
                    <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="check">Check</option><option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Reference"><input maxLength={200} value={paymentForm.reference} onChange={event => setPaymentForm({ ...paymentForm, reference: event.target.value })} className={inputCls()} placeholder="Transfer/check reference" /></Field>
              </div>
              <Field label="Notes"><textarea maxLength={2000} rows={2} value={paymentForm.notes} onChange={event => setPaymentForm({ ...paymentForm, notes: event.target.value })} className={inputCls()} placeholder="Optional details" /></Field>
              <ModalActions onCancel={() => setShowPaymentForm(false)} submitLabel={paymentSaving ? 'Saving...' : 'Save Payment'} disabled={paymentSaving} />
            </form>
          </ModalShell>
        )}

        {showBulk && (
          <ModalShell title="Bulk Attendance" onClose={() => !bulkBusy && setShowBulk(false)} wide>
            <form onSubmit={submitBulk} className="space-y-4">
              <p className="text-sm text-slate-600">Create attendance records for multiple employees. Payment dates are handled separately in Employee Payments and may be after the attendance date.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Date *" error={bulkErrors.date}><input type="date" value={bulk.date} onChange={e => setBulk({ ...bulk, date: e.target.value })} className={inputCls(bulkErrors.date)} /></Field>
                <Field label="Clock in *" error={bulkErrors.clock_in_time}><input type="time" value={bulk.clock_in_time} onChange={e => setBulk({ ...bulk, clock_in_time: e.target.value })} className={inputCls(bulkErrors.clock_in_time)} /></Field>
                <Field label="Clock out" error={bulkErrors.clock_out_time}><input type="time" value={bulk.clock_out_time} onChange={e => setBulk({ ...bulk, clock_out_time: e.target.value })} className={inputCls(bulkErrors.clock_out_time)} /></Field>
                <Field label="Attendance status"><select value={bulk.status} onChange={e => setBulk({ ...bulk, status: e.target.value })} className={selectCls()}>{ATTENDANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
              </div>
              <Field label="Notes"><input value={bulk.notes} onChange={e => setBulk({ ...bulk, notes: e.target.value })} className={inputCls()} placeholder="Optional note applied to all records" /></Field>
              <Field label={`Employees * (${bulk.employee_ids.length} selected)`} error={bulkErrors.employee_ids}>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button type="button" className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setBulk(b => ({ ...b, employee_ids: employees.filter(e => e.status === 'active').map(e => e.id) }))}>Select active</button>
                  <button type="button" className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200" onClick={() => setBulk(b => ({ ...b, employee_ids: [] }))}>Clear</button>
                </div>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1 bg-slate-50/40">
                  {employees.map(emp => (
                    <label key={emp.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-white cursor-pointer"><input type="checkbox" checked={bulk.employee_ids.includes(emp.id)} onChange={() => toggleBulkEmployee(emp.id)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /><span className="truncate">{emp.full_name}</span><span className="text-xs text-slate-400 ml-auto">{String(emp.employment_type || '').replace('_', ' ')}</span></label>
                  ))}
                  {employees.length === 0 && <p className="text-sm text-slate-500 p-2">Add employees first.</p>}
                </div>
              </Field>
              <ModalActions onCancel={() => !bulkBusy && setShowBulk(false)} submitLabel={bulkBusy ? 'Saving...' : `Create ${bulk.employee_ids.length || ''} Attendance Records`} disabled={bulkBusy} />
            </form>
          </ModalShell>
        )}

        <ConfirmationModal isOpen={confirm.open} onClose={() => setConfirm({ open: false, kind: null, id: null })} onConfirm={onConfirmDelete} title={confirm.kind === 'employee' ? 'Delete Employee' : confirm.kind === 'payment' ? 'Delete Payment Record' : 'Delete Attendance Record'} message={confirm.kind === 'employee' ? 'Delete this employee? Related attendance/payroll records may be affected by database constraints.' : confirm.kind === 'payment' ? 'Delete this payment record? The action will be recorded in audit history.' : 'Are you sure you want to delete this attendance record?'} confirmText="Delete" variant="danger" />
      </div>
    </div>
  );
}

function ModalShell({ title, children, onClose, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.98, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} className={`bg-white w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 shadow-xl`}>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 pr-8">{title}</h2>
        {children}
      </motion.div>
    </div>
  );
}
function ModalActions({ onCancel, submitLabel, disabled = false }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 sticky bottom-0 bg-white pb-1">
      <button type="button" onClick={onCancel} disabled={disabled} className="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-lg hover:bg-slate-300 font-medium disabled:opacity-60">Cancel</button>
      <button type="submit" disabled={disabled} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-60">{submitLabel}</button>
    </div>
  );
}
function Pager({ meta, onPage }) {
  return <Pagination {...meta} pageSize={meta?.size ?? 10} onPage={onPage} />;
}
function addedBy(record) {
  return displayName(record.created_by_name, 'Unknown (before tracking)');
}
function SummaryChip({ icon: Icon, label, value, tone = 'slate' }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-50 text-amber-800 border border-amber-100', emerald: 'bg-emerald-50 text-emerald-800 border border-emerald-100' };
  return <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${tones[tone] || tones.slate}`}><Icon className="w-4 h-4" /><span className="text-slate-500">{label}:</span><span className="font-semibold">{value}</span></div>;
}
function StatusBadge({ value }) {
  const cls = { active: 'bg-emerald-50 text-emerald-700', inactive: 'bg-slate-100 text-slate-700', on_leave: 'bg-amber-50 text-amber-700', terminated: 'bg-red-50 text-red-700', present: 'bg-emerald-50 text-emerald-700', absent: 'bg-red-50 text-red-700', late: 'bg-amber-50 text-amber-700', half_day: 'bg-blue-50 text-blue-700', leave: 'bg-slate-100 text-slate-700', unpaid: 'bg-amber-50 text-amber-700', processing: 'bg-blue-50 text-blue-700', paid: 'bg-emerald-50 text-emerald-700' }[value] || 'bg-slate-100 text-slate-700';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{String(value || '—').replace(/_/g, ' ')}</span>;
}
function Field({ label, error, children }) { return <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>{children}{error && <span className="text-red-500 text-xs mt-1 block">{error}</span>}</label>; }
function inputCls(error) { return `w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${error ? 'border-red-300 focus:ring-red-500' : 'border-slate-300 focus:ring-blue-500'}`; }
function selectCls(error) { return inputCls(error); }
function iconBtnCls(color) { return `p-2 text-slate-500 ${{ blue: 'hover:text-blue-600 hover:bg-blue-50', red: 'hover:text-red-600 hover:bg-red-50' }[color] || ''} rounded-lg transition-colors`; }
