import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Revenue, Expense, Customer } from '@/entities/all';
import {
  FileSpreadsheet,
  Plus,
  Edit,
  Trash2,
  DollarSign,
  TrendingDown,
  Calendar,
  User,
  Building,
} from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/toast';
import ConfirmationModal from '@/components/ui/confirmation-modal';
import CategoryManager from '../utils/categories';
import Pagination from '@/components/ui/pagination';
import { useRBAC } from '@/hooks/useRBAC';
import { displayName } from '@/lib/displayName';

export default function Reports() {
  const { toast } = useToast();
  const { role } = useRBAC();
  const isEmployee = role === 'employee';
  const [revenues, setRevenues] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('revenues');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({});
  const [selectedItems, setSelectedItems] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    q: '', category: '', date_from: '', date_to: '', min_amount: '', max_amount: '', person: '', sort: 'date_desc',
  });
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    type: '',
    data: null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const saveLock = useRef(false);
  const deleteLock = useRef(false);

  useEffect(() => {
    loadData();
  }, []);

  // Debug selectedItems changes
  useEffect(() => {
    console.log(
      '🔍 selectedItems STATE CHANGED:',
      JSON.stringify(selectedItems)
    );
    console.log('🔍 selectedItems length:', selectedItems.length);
    console.log('🔍 selectedItems type:', typeof selectedItems);
    console.log('🔍 selectedItems is array:', Array.isArray(selectedItems));

    // Check if this is an unexpected change
    if (selectedItems.length > 1) {
      console.warn('⚠️ MULTIPLE ITEMS SELECTED - This might be the bug!');
      console.trace('Multiple selection call stack');
    }
  }, [selectedItems]);

  const loadData = async () => {
    console.log('Reports: Loading data...');
    setIsLoading(true);
    try {
      const [revenueData, expenseData, customerData] = await Promise.all([
        Revenue.list(),
        Expense.list(),
        Customer.list(),
      ]);

      console.log('Reports: Loaded data:', {
        revenues: revenueData.length,
        expenses: expenseData.length,
        customers: customerData.length,
      });

      setRevenues(revenueData);
      setExpenses(expenseData);
      setCustomers(customerData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setIsLoading(false);
  };

  const getInitialFormData = type => {
    if (type === 'revenue') {
      return {
        amount: 0,
        source: '',
        category: CategoryManager.getDefaultCategory('revenue'),
        date: format(new Date(), 'yyyy-MM-dd'),
        customer_name: '',
        description: '',
      };
    } else {
      return {
        amount: 0,
        category: CategoryManager.getDefaultCategory('expense'),
        vendor: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        description: '',
        receipt_url: '',
      };
    }
  };

  const handleAdd = type => {
    setEditingItem(null);
    setFormData(getInitialFormData(type));
    setActiveTab(type === 'revenue' ? 'revenues' : 'expenses');
    setShowForm(true);
  };

  const handleEdit = (item, type) => {
    console.log('🔧 EDIT CLICKED:', { item, type });
    console.log('Setting editing item:', item);
    console.log('Setting form data:', item);

    setEditingItem(item);
    setFormData(item);
    setActiveTab(type === 'revenue' ? 'revenues' : 'expenses');
    setShowForm(true);

    console.log('Edit form should now be visible');
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setIsSaving(true);
    try {
      let result;
      if (activeTab === 'revenues') {
        if (editingItem) {
          result = await Revenue.update(editingItem.id, formData);
        } else {
          result = await Revenue.create(formData);
        }
      } else {
        if (editingItem) {
          result = await Expense.update(editingItem.id, formData);
        } else {
          result = await Expense.create(formData);
        }
      }
      await loadData();
      resetForm();
      toast.success(result?.pendingApproval
        ? 'Amount change sent for approval. The saved amount will update after it is approved.'
        : `${editingItem ? 'Changes saved' : 'Record added'} successfully.`);
    } catch (error) {
      console.error('Error saving item:', error);
      toast.error(`Could not save this record: ${error.message}`);
    } finally {
      saveLock.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = (id, type) => {
    console.log('🗑️ DELETE CLICKED:', { id, type });
    setConfirmModal({
      isOpen: true,
      type: 'single-delete',
      data: { id, type },
    });
  };

  const confirmSingleDelete = async () => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setIsDeleting(true);
    const { id, type } = confirmModal.data;
    console.log(`Attempting to delete ${type} with ID:`, id);

    try {
      let result;
      if (type === 'revenue') {
        console.log('Calling Revenue.delete...');
        result = await Revenue.delete(id);
        console.log('Revenue delete result:', result);
      } else {
        console.log('Calling Expense.delete...');
        result = await Expense.delete(id);
        console.log('Expense delete result:', result);
      }

      console.log('Reloading data after delete...');
      await loadData();
      console.log('Data reloaded successfully');

      // Show success toast
      toast.success(result?.pendingApproval
        ? `${type.charAt(0).toUpperCase() + type.slice(1)} deletion sent for approval. The record is still available until it is approved.`
        : `${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully!`);
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error(`Error deleting ${type}: ${error.message}`);
    } finally {
      deleteLock.current = false;
      setIsDeleting(false);
    }
  };

  const resetForm = () => {
    setFormData({});
    setEditingItem(null);
    setShowForm(false);
  };

  const handleConfirmAction = () => {
    if (confirmModal.type === 'single-delete') {
      confirmSingleDelete();
    } else if (confirmModal.type === 'bulk-delete') {
      confirmBulkDelete();
    }
  };

  const closeConfirmModal = () => {
    setConfirmModal({ isOpen: false, type: '', data: null });
  };

  const getConfirmModalProps = () => {
    if (confirmModal.type === 'single-delete') {
      const { type } = confirmModal.data;
      return {
        title: isEmployee ? `Request ${type} deletion` : `Delete ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        message: isEmployee
          ? `Send this ${type} deletion to an administrator for review? The record remains until it is approved.`
          : `Are you sure you want to delete this ${type}? This action cannot be undone.`,
        confirmText: isEmployee ? 'Send for approval' : 'Delete',
        variant: 'danger',
      };
    } else if (confirmModal.type === 'bulk-delete') {
      const { selectedItems: itemsToDelete, itemType } = confirmModal.data;
      return {
        title: isEmployee ? `Request deletion of ${itemsToDelete.length} ${itemType} records` : `Delete ${itemsToDelete.length} ${itemType}${itemsToDelete.length > 1 ? 's' : ''}`,
        message: isEmployee
          ? `Send these ${itemsToDelete.length} records to an administrator for review? They will remain until approved.`
          : `Are you sure you want to delete ${itemsToDelete.length} ${itemType}${itemsToDelete.length > 1 ? 's' : ''}? This action cannot be undone.`,
        confirmText: isEmployee ? 'Send for approval' : 'Delete All',
        variant: 'danger',
      };
    }
    return {};
  };

  // Tab change handler
  const handleTabChange = tab => {
    setActiveTab(tab);
    setSelectedItems([]);
    setIsSelectionMode(false);
  };

  // Bulk delete functionality
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedItems([]);
  };

  const toggleItemSelection = id => {
    // Normalize IDs to strings to avoid 1 vs '1' mismatches
    const sid = String(id);
    console.log('☑️ CHECKBOX CLICKED for ID:', sid);
    console.log(
      'Current selected items before toggle:',
      JSON.stringify(selectedItems)
    );

    setSelectedItems(prevSelected => {
      // Use a Set to guarantee uniqueness and avoid duplicates under StrictMode
      const set = new Set(prevSelected.map(String));
      console.log('Inside setSelectedItems - current Set:', Array.from(set));

      if (set.has(sid)) {
        set.delete(sid);
        console.log('Removed from selection:', sid);
      } else {
        set.add(sid);
        console.log('Added to selection:', sid);
      }

      const next = Array.from(set);
      console.log('Next selection (unique):', next);
      return next;
    });
  };

  const selectAllItems = event => {
    if (!event || !event.target) return;
    const allIds = filteredReportItems.map(item => String(item.id));
    const allSelected = allIds.length > 0 && allIds.every(id => selectedItems.map(String).includes(id));
    setSelectedItems(allSelected ? selectedItems.filter(id => !allIds.includes(String(id))) : [...new Set([...selectedItems.map(String), ...allIds])]);
  };

  const handleBulkDelete = () => {
    console.log('🗑️ BULK DELETE CLICKED');
    console.log('Selected items:', selectedItems);
    console.log('Active tab:', activeTab);

    if (selectedItems.length === 0) {
      console.log('No items selected');
      toast.warning('Please select items to delete');
      return;
    }

    const itemType = activeTab === 'revenues' ? 'revenue' : 'expense';
    setConfirmModal({
      isOpen: true,
      type: 'bulk-delete',
      data: { selectedItems: [...selectedItems], itemType },
    });
  };

  const confirmBulkDelete = async () => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setIsDeleting(true);
    const { selectedItems: itemsToDelete, itemType } = confirmModal.data;
    console.log('User confirmed bulk deletion');

    try {
      console.log(
        `Bulk deleting ${itemsToDelete.length} ${itemType}s:`,
        itemsToDelete
      );

      const deleteResult = activeTab === 'revenues'
        ? await Revenue.bulkDelete(itemsToDelete)
        : await Expense.bulkDelete(itemsToDelete);

      console.log('Bulk delete completed, reloading data...');
      await loadData();

      // Reset selection
      console.log('Resetting selection state...');
      const deletedCount = itemsToDelete.length;
      setSelectedItems([]);
      setIsSelectionMode(false);

      if (deleteResult?.pendingApproval) {
        toast.success('Bulk deletion sent for approval. The selected records remain until it is approved.');
      } else {
        toast.success(`Successfully deleted ${deleteResult?.deletedCount ?? deletedCount} ${itemType}${deletedCount > 1 ? 's' : ''}!`);
      }
    } catch (error) {
      console.error('Error in bulk delete:', error);
      toast.error(`Error deleting items: ${error.message}`);
    } finally {
      deleteLock.current = false;
      setIsDeleting(false);
    }
  };

  const getCategoryColor = category => {
    // Determine type based on category
    const revenueCategories = Object.keys(
      CategoryManager.getCategories('revenue')
    );
    const actualType = revenueCategories.includes(category)
      ? 'revenue'
      : 'expense';

    return CategoryManager.getCategoryColorClass(actualType, category);
  };

  const updateReportFilter = (key, value) => {
    setReportFilters(f => ({ ...f, [key]: value }));
    setSelectedItems([]);
  };

  const clearReportFilters = () => {
    setReportFilters({ q: '', category: '', date_from: '', date_to: '', min_amount: '', max_amount: '', person: '', sort: 'date_desc' });
    setSelectedItems([]);
  };

  const filteredReportItems = useMemo(() => {
    const source = activeTab === 'revenues' ? revenues : expenses;
    const q = reportFilters.q.trim().toLowerCase();
    const person = reportFilters.person.trim().toLowerCase();
    const min = reportFilters.min_amount !== '' ? Number(reportFilters.min_amount) : null;
    const max = reportFilters.max_amount !== '' ? Number(reportFilters.max_amount) : null;
    let items = Array.isArray(source) ? [...source] : [];
    if (reportFilters.category) items = items.filter(i => String(i.category || '') === reportFilters.category);
    if (reportFilters.date_from) items = items.filter(i => i.date && String(i.date).slice(0, 10) >= reportFilters.date_from);
    if (reportFilters.date_to) items = items.filter(i => i.date && String(i.date).slice(0, 10) <= reportFilters.date_to);
    if (min != null && !Number.isNaN(min)) items = items.filter(i => (Number(i.amount) || 0) >= min);
    if (max != null && !Number.isNaN(max)) items = items.filter(i => (Number(i.amount) || 0) <= max);
    if (person) {
      items = items.filter(i => String(activeTab === 'revenues' ? (i.customer_name || i.source) : i.vendor || '').toLowerCase().includes(person));
    }
    if (q) {
      items = items.filter(i => {
        const hay = [i.description, i.source, i.customer_name, i.vendor, i.category, i.amount, i.date].map(v => String(v || '').toLowerCase()).join(' ');
        return hay.includes(q);
      });
    }
    items.sort((a, b) => {
      switch (reportFilters.sort) {
        case 'date_asc': return String(a.date || '').localeCompare(String(b.date || ''));
        case 'amount_desc': return (Number(b.amount) || 0) - (Number(a.amount) || 0);
        case 'amount_asc': return (Number(a.amount) || 0) - (Number(b.amount) || 0);
        case 'date_desc':
        default: return String(b.date || '').localeCompare(String(a.date || ''));
      }
    });
    return items;
  }, [activeTab, revenues, expenses, reportFilters]);

  useEffect(() => { setPage(1); }, [activeTab, reportFilters, revenues.length, expenses.length]);
  const pagedReportItems = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredReportItems.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return { items: filteredReportItems.slice(start, start + pageSize), page: safePage, totalPages, total: filteredReportItems.length, start: filteredReportItems.length ? start + 1 : 0, end: Math.min(start + pageSize, filteredReportItems.length) };
  }, [filteredReportItems, page]);

  const reportTotals = useMemo(() => ({
    count: filteredReportItems.length,
    total: filteredReportItems.reduce((s, i) => s + (Number(i.amount) || 0), 0),
  }), [filteredReportItems]);

  const categoryFilterOptions = useMemo(
    () => CategoryManager.getCategoryOptions(activeTab === 'revenues' ? 'revenue' : 'expense'),
    [activeTab]
  );

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-64"></div>
            <div className="h-96 bg-slate-200 rounded-2xl"></div>
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
          <div className="flex flex-col gap-3 lg:flex-row lg:justify-between lg:items-center mb-6 md:mb-8">
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-1 md:mb-2">
                Financial Reports
              </h1>
              <p className="text-slate-600 text-sm sm:text-base md:text-lg">
                Manage your revenue and expense records
              </p>
            </div>
            <div className="flex flex-wrap gap-2 w-full lg:w-auto">
              <button
                onClick={() => handleAdd('revenue')}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200 font-medium text-sm touch-manipulation"
              >
                <Plus className="w-4 h-4" />
                Add Revenue
              </button>
              <button
                onClick={() => handleAdd('expense')}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200 font-medium text-sm touch-manipulation"
              >
                <Plus className="w-4 h-4" />
                Add Expense
              </button>

              {/* Bulk Delete Controls */}
              <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:border-l sm:pl-2 sm:ml-1 border-slate-200">
                <button
                  onClick={toggleSelectionMode}
                  className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg transition-colors duration-200 font-medium text-sm touch-manipulation ${
                    isSelectionMode
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  {isSelectionMode ? 'Cancel' : 'Select'}
                </button>

                {isSelectionMode && (
                  <>
                    <button
                      onClick={selectAllItems}
                      className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors duration-200 font-medium text-sm touch-manipulation"
                    >
                      {selectedItems.length === filteredReportItems.length && filteredReportItems.length > 0
                        ? 'Deselect All'
                        : 'Select All'}
                    </button>

                    {selectedItems.length > 0 && (
                      <button
                        onClick={handleBulkDelete}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200 font-medium text-sm touch-manipulation"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete ({selectedItems.length})
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
          <CardHeader className="pb-3"><CardTitle className="text-lg">Financial Report Filters</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="block xl:col-span-2">
                <span className="text-xs font-medium text-slate-600">Search</span>
                <input value={reportFilters.q} onChange={e => updateReportFilter('q', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder={activeTab === 'revenues' ? 'Description, source, customer, category...' : 'Description, vendor, category...'} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Category</span>
                <select value={reportFilters.category} onChange={e => updateReportFilter('category', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">All categories</option>
                  {categoryFilterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">{activeTab === 'revenues' ? 'Customer / Source' : 'Vendor'}</span>
                <input value={reportFilters.person} onChange={e => updateReportFilter('person', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Contains..." />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Date from</span>
                <input type="date" value={reportFilters.date_from} onChange={e => updateReportFilter('date_from', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Date to</span>
                <input type="date" value={reportFilters.date_to} onChange={e => updateReportFilter('date_to', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Min amount</span>
                <input type="number" min="0" step="0.01" value={reportFilters.min_amount} onChange={e => updateReportFilter('min_amount', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Max amount</span>
                <input type="number" min="0" step="0.01" value={reportFilters.max_amount} onChange={e => updateReportFilter('max_amount', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Any" />
              </label>
              <label className="block sm:col-span-2 xl:col-span-4">
                <span className="text-xs font-medium text-slate-600">Sort</span>
                <select value={reportFilters.sort} onChange={e => updateReportFilter('sort', e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="date_desc">Newest date</option><option value="date_asc">Oldest date</option><option value="amount_desc">Highest amount</option><option value="amount_asc">Lowest amount</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-slate-600">Showing <span className="font-semibold text-slate-900">{pagedReportItems.start}–{pagedReportItems.end}</span> of {reportTotals.count} filtered ({(activeTab === 'revenues' ? revenues : expenses).length} total) • Total <span className="font-semibold text-slate-900">${reportTotals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              <button type="button" onClick={clearReportFilters} className="text-blue-600 hover:text-blue-700 font-medium">Clear filters</button>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => handleTabChange('revenues')}
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors duration-200 ${
              activeTab === 'revenues'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Revenues ({revenues.length})
          </button>
          <button
            onClick={() => handleTabChange('expenses')}
            className={`flex-1 py-2 px-4 rounded-md font-medium transition-colors duration-200 ${
              activeTab === 'expenses'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Expenses ({expenses.length})
          </button>
        </div>

        {/* Form Modal */}
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <h2 className="text-2xl font-bold text-slate-900 mb-6">
                {editingItem && isEmployee
                  ? `Request ${activeTab === 'revenues' ? 'revenue' : 'expense'} amount change`
                  : `${editingItem ? 'Edit' : 'Add'} ${activeTab === 'revenues' ? 'Revenue' : 'Expense'}`}
              </h2>
              {editingItem && isEmployee && (
                <p className="mb-4 text-sm text-slate-600">Changing an existing amount requires approval. Other transaction details can only be changed by an administrator.</p>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Amount ($) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={formData.amount || ''}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        amount: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {(!isEmployee || !editingItem) && (activeTab === 'revenues' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Source
                      </label>
                      <input
                        type="text"
                        value={formData.source || ''}
                        onChange={e =>
                          setFormData({ ...formData, source: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Category
                      </label>
                      <select
                        value={
                          formData.category ||
                          CategoryManager.getDefaultCategory('revenue')
                        }
                        onChange={e =>
                          setFormData({ ...formData, category: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {CategoryManager.getCategoryOptions('revenue').map(
                          option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        value={formData.customer_name || ''}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            customer_name: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Category
                      </label>
                      <select
                        value={
                          formData.category ||
                          CategoryManager.getDefaultCategory('expense')
                        }
                        onChange={e =>
                          setFormData({ ...formData, category: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {CategoryManager.getCategoryOptions('expense').map(
                          option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Vendor
                      </label>
                      <input
                        type="text"
                        value={formData.vendor || ''}
                        onChange={e =>
                          setFormData({ ...formData, vendor: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </>
                ))}

                {(!isEmployee || !editingItem) && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.date || ''}
                        onChange={e =>
                          setFormData({ ...formData, date: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={formData.description || ''}
                        onChange={e =>
                          setFormData({ ...formData, description: e.target.value })
                        }
                        rows={3}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium disabled:opacity-60"
                  >
                    {isSaving ? 'Saving...' : editingItem && isEmployee ? 'Send amount change for approval' : editingItem ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={isSaving}
                    className="flex-1 bg-slate-200 text-slate-700 py-2 rounded-lg hover:bg-slate-300 transition-colors duration-200 font-medium disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {/* Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {activeTab === 'revenues' ? (
                  <>
                    <DollarSign className="w-5 h-5 text-green-600" />
                    Revenue Records
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-5 h-5 text-red-600" />
                    Expense Records
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pagedReportItems.items.map(
                  (item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors duration-200"
                    >
                      {/* Selection Checkbox */}
                      {isSelectionMode && (
                        <div className="mr-3">
                          <input
                            type="checkbox"
                            id={`checkbox-${item.id}`}
                            checked={selectedItems
                              .map(String)
                              .includes(String(item.id))}
                            readOnly
                            onClick={e => {
                              console.log(`�️ Checkbox ${item.id} CLICKED`);
                              console.log(
                                'Checkbox checked state before click:',
                                selectedItems.includes(item.id)
                              );
                              console.log(
                                'Current selectedItems before click:',
                                JSON.stringify(selectedItems)
                              );
                              e.stopPropagation();
                              toggleItemSelection(item.id);
                            }}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                          />
                        </div>
                      )}

                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-lg font-semibold text-slate-900">
                            ${item.amount.toLocaleString()}
                          </span>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(item.category)}`}
                          >
                            {CategoryManager.getCategoryLabel(
                              activeTab === 'revenues' ? 'revenue' : 'expense',
                              item.category
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {format(new Date(item.date), 'MMM d, yyyy')}
                          </div>
                          {activeTab === 'revenues'
                            ? item.customer_name && (
                                <div className="flex items-center gap-1">
                                  <User className="w-4 h-4" />
                                  {item.customer_name}
                                </div>
                              )
                            : item.vendor && (
                                <div className="flex items-center gap-1">
                                  <Building className="w-4 h-4" />
                                  {item.vendor}
                                </div>
                              )}
                        </div>
                        {item.description && (
                          <p className="text-sm text-slate-600 mt-1">
                            {item.description}
                          </p>
                        )}
                        <p className="text-xs text-slate-500 mt-1">
                          Added by: {displayName(item.created_by_name, 'Unknown (before tracking)')}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleEdit(
                              item,
                              activeTab === 'revenues' ? 'revenue' : 'expense'
                            );
                          }}
                          aria-label={isEmployee ? 'Request amount change' : 'Edit transaction'}
                          className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDelete(
                              item.id,
                              activeTab === 'revenues' ? 'revenue' : 'expense'
                            );
                          }}
                          aria-label={isEmployee ? 'Request transaction deletion' : 'Delete transaction'}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  )
                )}

                <Pagination {...pagedReportItems} pageSize={pageSize} onPage={setPage} />

                {filteredReportItems.length === 0 &&
                  (activeTab === 'revenues' ? revenues : expenses).length > 0 && (
                  <div className="text-center py-12">
                    <FileSpreadsheet className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">No matching records</h3>
                    <p className="text-slate-600 mb-4">Try adjusting your financial report filters.</p>
                    <button type="button" onClick={clearReportFilters} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium">Clear filters</button>
                  </div>
                )}

                {(activeTab === 'revenues' ? revenues : expenses).length ===
                  0 && (
                  <div className="text-center py-12">
                    <FileSpreadsheet className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">
                      No {activeTab} yet
                    </h3>
                    <p className="text-slate-600 mb-6">
                      Get started by adding your first{' '}
                      {activeTab === 'revenues' ? 'revenue' : 'expense'} record
                    </p>
                    <button
                      onClick={() =>
                        handleAdd(
                          activeTab === 'revenues' ? 'revenue' : 'expense'
                        )
                      }
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      Add {activeTab === 'revenues' ? 'Revenue' : 'Expense'}
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Confirmation Modal */}
        <ConfirmationModal
          isOpen={confirmModal.isOpen}
          onClose={closeConfirmModal}
          onConfirm={handleConfirmAction}
          {...getConfirmModalProps()}
        />
      </div>
    </div>
  );
}
