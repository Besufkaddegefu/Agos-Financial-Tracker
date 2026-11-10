export function createPageUrl(pageName) {
  const map = {
    Dashboard: '/dashboard',
    Analytics: '/analytics',
    Customers: '/customers',
    Reports: '/reports',
    HRPayroll: '/hr-payroll',
  };
  return map[pageName] || `/${String(pageName).toLowerCase()}`;
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
