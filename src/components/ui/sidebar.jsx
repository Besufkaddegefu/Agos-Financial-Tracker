import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { X, Menu } from 'lucide-react';
import { cn } from '@/utils';

const SidebarContext = createContext({ open: false, setOpen: () => {}, toggle: () => {} });
export const useSidebar = () => useContext(SidebarContext);

function useIsMobile() {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    window.addEventListener('resize', onChange);
    return () => { mq.removeEventListener?.('change', onChange); window.removeEventListener('resize', onChange); };
  }, []);
  return mobile;
}

const SidebarProvider = ({ children, ...props }) => {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);
  const toggle = useCallback(() => setOpen(v => !v), []);
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle, isMobile }}>
      <div {...props}>{children}</div>
    </SidebarContext.Provider>
  );
};

const Sidebar = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, setOpen, isMobile } = useSidebar();
  if (isMobile) {
    return (
      <>
        <div
          className={cn('fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] transition-opacity md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <aside
          ref={ref}
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-[min(18rem,86vw)] max-w-[18rem] h-[100dvh] transform transition-transform duration-200 ease-out md:hidden flex flex-col',
            open ? 'translate-x-0' : '-translate-x-full',
            className
          )}
          {...props}
        >
          <button type="button" aria-label="Close menu" className="absolute right-2 top-2 p-2 rounded-lg text-slate-500 hover:bg-slate-100 md:hidden" onClick={() => setOpen(false)}>
            <X className="w-5 h-5" />
          </button>
          {children}
        </aside>
      </>
    );
  }
  return (
    <aside ref={ref} className={cn('hidden md:flex md:flex-col w-64 h-screen shrink-0 sticky top-0', className)} {...props}>
      {children}
    </aside>
  );
});
Sidebar.displayName = 'Sidebar';

const SidebarHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
SidebarHeader.displayName = 'SidebarHeader';

const SidebarContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex-1 overflow-y-auto overscroll-contain', className)} {...props} />
));
SidebarContent.displayName = 'SidebarContent';

const SidebarGroup = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
SidebarGroup.displayName = 'SidebarGroup';

const SidebarGroupLabel = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
SidebarGroupLabel.displayName = 'SidebarGroupLabel';

const SidebarGroupContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
SidebarGroupContent.displayName = 'SidebarGroupContent';

const SidebarMenu = React.forwardRef(({ className, ...props }, ref) => (
  <ul ref={ref} className={cn('', className)} {...props} />
));
SidebarMenu.displayName = 'SidebarMenu';

const SidebarMenuItem = React.forwardRef(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
));
SidebarMenuItem.displayName = 'SidebarMenuItem';

const SidebarMenuButton = React.forwardRef(
  ({ className, asChild, onClick, children, ...props }, ref) => {
    const { setOpen, isMobile } = useSidebar();
    const handleClick = (e) => { onClick?.(e); if (isMobile) setOpen(false); };
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ref,
        className: cn(className, children.props.className),
        onClick: (e) => { children.props.onClick?.(e); handleClick(e); },
        ...props,
      });
    }
    return (
      <button
        ref={ref}
        type="button"
        className={cn('w-full text-left', className)}
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  }
);
SidebarMenuButton.displayName = 'SidebarMenuButton';

const SidebarFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
SidebarFooter.displayName = 'SidebarFooter';

const SidebarTrigger = React.forwardRef(({ className, onClick, children, ...props }, ref) => {
  const { toggle } = useSidebar();
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Open menu"
      className={cn('inline-flex items-center justify-center', className)}
      onClick={(e) => { onClick?.(e); toggle(); }}
      {...props}
    >
      {children || <Menu className="w-5 h-5 text-slate-700" />}
    </button>
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

export {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
};
