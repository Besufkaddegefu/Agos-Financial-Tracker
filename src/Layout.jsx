import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { createPageUrl } from '@/utils';
import {
  BarChart3,
  TrendingUp,
  Users,
  FileSpreadsheet,
  Briefcase,
  ClipboardList,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { useRBAC } from '@/hooks/useRBAC';
import { ROLE_LABELS } from '@/lib/rbac';

const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

const baseNavigationItems = [
  { title: 'Dashboard', url: createPageUrl('Dashboard'), icon: BarChart3, minRole: null },
  { title: 'Analytics', url: createPageUrl('Analytics'), icon: TrendingUp, minRole: null },
  { title: 'Customers', url: createPageUrl('Customers'), icon: Users, minRole: null },
  { title: 'HR & Staff', url: '/hr-payroll', icon: Briefcase, minRole: 'admin' },
  { title: 'Reports', url: createPageUrl('Reports'), icon: FileSpreadsheet, minRole: 'employee' },
  { title: 'My Requests', url: '/my-requests', icon: ClipboardList, minRole: 'employee' },
];

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const { role, hasRole, clerkConfigured: authEnabled } = useRBAC();
  const navigationItems = baseNavigationItems.filter(
    item => !item.minRole || !authEnabled || hasRole(item.minRole)
  );

  return (
    <SidebarProvider>
      <style>
        {`
          :root {
            --primary: 220 85% 57%;
            --primary-foreground: 210 40% 98%;
            --secondary: 210 40% 96%;
            --secondary-foreground: 222.2 84% 4.9%;
            --muted: 210 40% 96%;
            --muted-foreground: 215.4 16.3% 46.9%;
            --accent: 210 40% 94%;
            --accent-foreground: 222.2 84% 4.9%;
            --destructive: 0 84.2% 60.2%;
            --destructive-foreground: 210 40% 98%;
            --border: 214.3 31.8% 91.4%;
            --input: 214.3 31.8% 91.4%;
            --ring: 220 85% 57%;
            --radius: 0.75rem;
          }
        `}
      </style>
      <div className="min-h-screen flex w-full min-w-0 bg-slate-50">
        <Sidebar className="border-r border-slate-200/60 bg-white/80 backdrop-blur-sm">
          <SidebarHeader className="border-b border-slate-200/60 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-lg">
                  Business Hub
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Analytics Dashboard
                </p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-4">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2">
                Navigation
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {navigationItems.map(item => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className={`hover:bg-blue-50/80 hover:text-blue-700 transition-all duration-300 rounded-xl px-4 py-3 ${
                          location.pathname === item.url
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-200'
                            : 'text-slate-600'
                        }`}
                      >
                        <Link to={item.url} className="flex items-center gap-3">
                          <item.icon className="w-5 h-5" />
                          <span className="font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-slate-200/60 p-4">
            {clerkConfigured ? (
              <div className="flex items-center gap-3">
                <UserButton afterSignOutUrl="/sign-in" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">Account</p>
                  <p className="text-xs text-slate-500">{role ? (ROLE_LABELS[role] || role) : 'Signed in'}</p>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Local mode{role ? ` (${ROLE_LABELS[role] || role})` : ''}
              </div>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200/60 px-4 py-3 md:hidden">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hover:bg-slate-100 p-2 -ml-1 rounded-lg transition-colors duration-200" />
              <h1 className="text-lg font-bold text-slate-900 truncate">Business Hub</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto overflow-x-hidden bg-gradient-to-br from-slate-50 to-slate-100/50">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
