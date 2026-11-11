import React, { useState, useEffect, useRef } from 'react';
import { Customer } from '@/entities/all';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Mail,
  Phone,
  Building,
  Calendar,
  DollarSign,
} from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/toast';
import ConfirmationModal from '@/components/ui/confirmation-modal';
import Pagination from '@/components/ui/pagination';
import { useRBAC } from '@/hooks/useRBAC';
import { displayName } from '@/lib/displayName';

export default function Customers() {
  const { toast } = useToast();
  const { role } = useRBAC();
  const isEmployee = role === 'employee';
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [filters, setFilters] = useState({ q: '', status: '', company: '', acquired_from: '', acquired_to: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    status: 'potential',
    total_value: 0,
    acquisition_date: format(new Date(), 'yyyy-MM-dd'),
  });
  const [formErrors, setFormErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const saveLock = useRef(false);
  const deleteLock = useRef(false);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    customerId: null,
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setIsLoading(true);
    try {
      const data = await Customer.list();
      // Filter out any null/undefined customers and ensure they have IDs
      const validCustomers = (data || []).filter(
        customer =>
          customer &&
          customer.id !== null &&
          customer.id !== undefined &&
          customer.email
      );
      console.log('Loaded customers:', validCustomers);
      setCustomers(validCustomers);
    } catch (error) {
      console.error('Error loading customers:', error);
      setCustomers([]); // Set empty array on error
    }
    setIsLoading(false);
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    }

    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Email is invalid';
    }

    if (!formData.company.trim()) {
      errors.company = 'Company is required';
    }

    if (formData.total_value < 0) {
      errors.total_value = 'Total value cannot be negative';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (saveLock.current) return;

    console.log('Form submission started');
    console.log('Editing customer:', editingCustomer);
    console.log('Form data:', formData);

    // Validate form
    if (!validateForm()) {
      console.log('Form validation failed');
      return;
    }

    // Validate for duplicates (only when creating new customer or changing email)
    if (
      !editingCustomer ||
      (editingCustomer &&
        editingCustomer.email.toLowerCase() !== formData.email.toLowerCase())
    ) {
      console.log('Checking for duplicates...');
      console.log('Current email:', editingCustomer?.email);
      console.log('New email:', formData.email);

      const isDuplicate = customers.some(
        customer =>
          customer.email.toLowerCase() === formData.email.toLowerCase() &&
          customer.id !== (editingCustomer?.id || null)
      );

      console.log('Is duplicate:', isDuplicate);

      if (isDuplicate) {
        console.log('Duplicate email detected');
        setFormErrors({ email: 'A customer with this email already exists!' });
        return;
      }
    } else {
      console.log(
        'Skipping duplicate check - same email for existing customer'
      );
    }

    saveLock.current = true;
    setIsSaving(true);
    try {
      // Ensure numeric values are properly converted
      const customerData = {
        ...formData,
        total_value: parseFloat(formData.total_value) || 0,
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        company: formData.company.trim(),
      };

      if (editingCustomer) {
        console.log('Updating customer:', editingCustomer.id, customerData);
        const result = await Customer.update(editingCustomer.id, customerData);
        console.log('Update result:', result);
      } else {
        console.log('Creating customer:', customerData);
        const result = await Customer.create(customerData);
        console.log('Create result:', result);
      }

      await loadCustomers();
      resetForm();
      const action = editingCustomer ? 'updated' : 'created';
      toast.success(`Customer ${action} successfully.`);
    } catch (error) {
      console.error('Error saving customer:', error);
      if (error.message.includes('already exists')) {
        setFormErrors({ email: error.message });
      } else {
        toast.error(`Error saving customer: ${error.message}`);
      }
    } finally {
      saveLock.current = false;
      setIsSaving(false);
    }
  };

  const handleEdit = customer => {
    console.log('Editing customer:', customer);
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      email: customer.email,
      phone: customer.phone || '',
      company: customer.company,
      status: customer.status,
      total_value: customer.total_value || 0,
      acquisition_date:
        customer.acquisition_date || format(new Date(), 'yyyy-MM-dd'),
    });
    setFormErrors({}); // Clear any existing errors
    setShowForm(true);
  };

  const handleDelete = id => {
    setConfirmModal({ isOpen: true, customerId: id });
  };

  const confirmDelete = async () => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setIsDeleting(true);
    try {
      const result = await Customer.delete(confirmModal.customerId);
      await loadCustomers();
      toast.success(result?.pendingApproval
        ? 'Customer deletion sent for approval. The customer is still in your list until it is approved.'
        : 'Customer deleted successfully!');
    } catch (error) {
      console.error('Error deleting customer:', error);
      toast.error(`Error deleting customer: ${error.message}`);
    } finally {
      deleteLock.current = false;
      setIsDeleting(false);
    }
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, customerId: null });
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      company: '',
      status: 'potential',
      total_value: 0,
      acquisition_date: format(new Date(), 'yyyy-MM-dd'),
    });
    setFormErrors({});
    setEditingCustomer(null);
    setShowForm(false);
  };

  const getStatusColor = status => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-800';
      case 'inactive':
        return 'bg-slate-100 text-slate-800';
      case 'potential':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  const filteredCustomers = React.useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    let items = customers.filter(customer => customer && customer.id);
    if (filters.status) items = items.filter(c => c.status === filters.status);
    if (filters.company) items = items.filter(c => String(c.company || '').toLowerCase().includes(filters.company.trim().toLowerCase()));
    if (filters.acquired_from) items = items.filter(c => c.acquisition_date && String(c.acquisition_date) >= filters.acquired_from);
    if (filters.acquired_to) items = items.filter(c => c.acquisition_date && String(c.acquisition_date) <= filters.acquired_to);
    if (q) {
      items = items.filter(c =>
        [c.name, c.email, c.phone, c.company, c.status].some(v => String(v || '').toLowerCase().includes(q))
      );
    }
    items = [...items].sort((a, b) => {
      switch (filters.sort) {
        case 'name_asc': return String(a.name || '').localeCompare(String(b.name || ''));
        case 'name_desc': return String(b.name || '').localeCompare(String(a.name || ''));
        case 'value_desc': return (Number(b.total_value) || 0) - (Number(a.total_value) || 0);
        case 'value_asc': return (Number(a.total_value) || 0) - (Number(b.total_value) || 0);
        case 'oldest': return String(a.acquisition_date || '').localeCompare(String(b.acquisition_date || ''));
        case 'newest':
        default: return String(b.acquisition_date || '').localeCompare(String(a.acquisition_date || ''));
      }
    });
    return items;
  }, [customers, filters]);

  useEffect(() => { setPage(1); }, [filters, customers.length]);
  const pagedCustomers = React.useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return { items: filteredCustomers.slice(start, start + pageSize), page: safePage, totalPages, total: filteredCustomers.length, start: filteredCustomers.length ? start + 1 : 0, end: Math.min(start + pageSize, filteredCustomers.length) };
  }, [filteredCustomers, page]);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-64"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array(6)
                .fill(0)
                .map((_, i) => (
                  <div key={i} className="h-48 bg-slate-200 rounded-2xl"></div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start md:items-center mb-6 md:mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 md:mb-2">
                Customer Management
              </h1>
              <p className="text-slate-600 text-sm sm:text-base md:text-lg">
                Manage your customer relationships and data
              </p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Customer
            </button>
          </div>
        </motion.div>

        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <label className="block lg:col-span-2">
                <span className="text-xs font-medium text-slate-600">Search clients</span>
                <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Name, email, phone, company..." />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">All statuses</option><option value="active">Active</option><option value="potential">Potential</option><option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Company</span>
                <input value={filters.company} onChange={e => setFilters(f => ({ ...f, company: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Company contains..." />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Acquired from</span>
                <input type="date" value={filters.acquired_from} onChange={e => setFilters(f => ({ ...f, acquired_from: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Acquired to</span>
                <input type="date" value={filters.acquired_to} onChange={e => setFilters(f => ({ ...f, acquired_to: e.target.value }))} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Sort</span>
                <select value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))} className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="newest">Newest acquired</option><option value="oldest">Oldest acquired</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option><option value="value_desc">Highest value</option><option value="value_asc">Lowest value</option>
                </select>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-600">Showing <span className="font-semibold text-slate-900">{pagedCustomers.start}–{pagedCustomers.end}</span> of {filteredCustomers.length} filtered ({customers.length} total)</span>
                <button type="button" onClick={() => setFilters({ q: '', status: '', company: '', acquired_from: '', acquired_to: '', sort: 'newest' })} className="text-blue-600 hover:text-blue-700 font-medium">Clear filters</button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Customer Form Modal */}
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={e => e.target === e.currentTarget && resetForm()}
          >
            <motion.div
              initial={{ scale: 0.98, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="bg-white w-full max-w-md max-h-[92vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 shadow-xl"
            >
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      formErrors.name
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  />
                  {formErrors.name && (
                    <p key="name-error" className="text-red-500 text-xs mt-1">
                      {formErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={e =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      formErrors.email
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                    placeholder="customer@example.com"
                  />
                  {formErrors.email ? (
                    <p key="email-error" className="text-red-500 text-xs mt-1">
                      {formErrors.email}
                    </p>
                  ) : (
                    <p key="email-help" className="text-xs text-gray-500 mt-1">
                      Email must be unique for each customer
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Company *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.company}
                    onChange={e =>
                      setFormData({ ...formData, company: e.target.value })
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      formErrors.company
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  />
                  {formErrors.company && (
                    <p
                      key="company-error"
                      className="text-red-500 text-xs mt-1"
                    >
                      {formErrors.company}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={e =>
                      setFormData({ ...formData, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="potential">Potential</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Total Value ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.total_value}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        total_value: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                      formErrors.total_value
                        ? 'border-red-300 focus:ring-red-500'
                        : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  />
                  {formErrors.total_value && (
                    <p
                      key="total-value-error"
                      className="text-red-500 text-xs mt-1"
                    >
                      {formErrors.total_value}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Acquisition Date
                  </label>
                  <input
                    type="date"
                    value={formData.acquisition_date}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        acquisition_date: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4 sticky bottom-0 bg-white pb-1">
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={isSaving}
                    className="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-lg hover:bg-slate-300 transition-colors duration-200 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium disabled:opacity-60"
                  >
                    {isSaving ? 'Saving...' : `${editingCustomer ? 'Update' : 'Create'} Customer`}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* Customer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pagedCustomers.items.map((customer, index) => (
              <motion.div
                key={`customer-${customer.id}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                          <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-bold text-slate-900">
                            {customer.name}
                          </CardTitle>
                          <span
                            className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(customer.status)}`}
                          >
                            {customer.status.charAt(0).toUpperCase() +
                              customer.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {!isEmployee && (
                          <button
                            onClick={() => handleEdit(customer)}
                            aria-label="Edit customer"
                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(customer.id)}
                          aria-label={isEmployee ? 'Request customer deletion' : 'Delete customer'}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Mail className="w-4 h-4" />
                      <span>{customer.email}</span>
                    </div>

                    {customer.phone && (
                      <div
                        key={`phone-${customer.id}`}
                        className="flex items-center gap-2 text-sm text-slate-600"
                      >
                        <Phone className="w-4 h-4" />
                        <span>{customer.phone}</span>
                      </div>
                    )}

                    {customer.company && (
                      <div
                        key={`company-${customer.id}`}
                        className="flex items-center gap-2 text-sm text-slate-600"
                      >
                        <Building className="w-4 h-4" />
                        <span>{customer.company}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Acquired:{' '}
                        {format(
                          new Date(customer.acquisition_date),
                          'MMM d, yyyy'
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <DollarSign className="w-4 h-4" />
                      <span>
                        Total Value: $
                        {customer.total_value?.toLocaleString() || '0'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Added by: {displayName(customer.created_by_name, 'Unknown (before tracking)')}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
        </div>

        <Pagination {...pagedCustomers} pageSize={pageSize} onPage={setPage} />

        {filteredCustomers.length === 0 && customers.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No matching clients</h3>
            <p className="text-slate-600 mb-4">Try adjusting your filters.</p>
            <button type="button" onClick={() => setFilters({ q: '', status: '', company: '', acquired_from: '', acquired_to: '', sort: 'newest' })} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">Clear filters</button>
          </motion.div>
        )}

        {customers.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No customers yet</h3>
            <p className="text-slate-600 mb-6">Get started by adding your first customer</p>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium">
              <Plus className="w-4 h-4" />
              Add Your First Customer
            </button>
          </motion.div>
        )}

        <ConfirmationModal
          isOpen={confirmModal.isOpen}
          onClose={closeConfirmModal}
          onConfirm={confirmDelete}
          title={isEmployee ? 'Request customer deletion' : 'Delete Customer'}
          message={isEmployee
            ? 'Send this customer deletion to an administrator for review? The customer will remain until it is approved.'
            : 'Are you sure you want to delete this customer? This action cannot be undone.'}
          confirmText={isDeleting ? 'Sending...' : isEmployee ? 'Send for approval' : 'Delete'}
          variant="danger"
        />
      </div>
    </div>
  );
}
