import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Drawer from '@radix-ui/react-dialog';
import { hasPermission, ROLE_LABELS, type Permission } from '@deviceflow/shared';
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  History,
  LayoutDashboard,
  LogOut,
  Laptop,
  Menu as MenuIcon,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCurrentUser, useLogout } from '../features/auth/session';
import { cn } from '../design/cn';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string;
  permission?: Permission;
  /** Modules not built yet are listed, clearly marked, but not linked. */
  plannedPhase?: number;
}

const NAV: Array<{ heading?: string; items: NavItem[] }> = [
  { items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/' }] },
  {
    heading: 'Operations',
    items: [
      { label: 'Repairs', icon: Wrench, to: '/repairs', permission: 'repairs:read' },
      { label: 'Assets', icon: Laptop, to: '/assets', permission: 'assets:read' },
      { label: 'Customers', icon: Building2, to: '/customers', permission: 'customers:read' },
      { label: 'Inventory', icon: Boxes, to: '/inventory', permission: 'inventory:read' },
    ],
  },
  {
    heading: 'Insights',
    // Administrators (all reports) and inventory managers (stock) both hold reports:inventory.
    items: [{ label: 'Reports', icon: BarChart3, to: '/reports', permission: 'reports:inventory' }],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', icon: Users, to: '/admin/users', permission: 'users:read' },
      { label: 'Activity', icon: History, to: '/admin/activity', permission: 'audit:read' },
      {
        label: 'Company settings',
        icon: Settings,
        to: '/admin/settings',
        permission: 'settings:read',
      },
    ],
  },
];

function NavEntry({ item }: { item: NavItem }) {
  const user = useCurrentUser();
  if (item.permission && !hasPermission(user.role, item.permission)) return null;
  const Icon = item.icon;

  if (!item.to) {
    return (
      <li>
        <span
          className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-sidebar-muted/60"
          title={`Arrives in Phase ${item.plannedPhase}`}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          <span className="rounded-sm border border-white/10 px-1 text-[10px] tracking-wide uppercase">
            P{item.plannedPhase}
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          cn(
            'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
            isActive
              ? 'bg-sidebar-active text-ink-inverse before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-accent-bright'
              : 'text-sidebar-muted hover:bg-sidebar-active/60 hover:text-ink-inverse',
          )
        }
      >
        <Icon size={16} aria-hidden="true" />
        {item.label}
      </NavLink>
    </li>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const logout = useLogout();
  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <Menu.Root>
      <Menu.Trigger className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-active">
        <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-accent text-[11px] font-semibold text-ink-inverse">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-inverse">{user.fullName}</span>
          <span className="block truncate text-[11px] text-sidebar-muted">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
        <ChevronDown size={14} className="text-sidebar-muted" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-md border border-line bg-surface p-1 shadow-[0_8px_24px_-8px_rgb(28_25_23/0.3)]"
        >
          <div className="px-2.5 py-2 text-[12px] text-ink-subtle">{user.email}</div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item
            onSelect={() => logout.mutate()}
            className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2.5 text-sm outline-none data-[highlighted]:bg-sunken"
          >
            <LogOut size={14} aria-hidden="true" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SidebarContent() {
  return (
    <>
      <div className="flex h-14 items-center gap-2 px-5">
        <img src="/favicon.svg" alt="" className="size-6" />
        <span className="text-[15px] font-semibold tracking-tight text-ink-inverse">
          DeviceFlow
        </span>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        {NAV.map((group, i) => (
          <div key={i} className="mb-4">
            {group.heading && (
              <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-sidebar-muted/70 uppercase">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <NavEntry key={item.label} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-2">
        <UserMenu />
      </div>
    </>
  );
}

/** Below the md breakpoint the sidebar becomes a slide-in drawer. */
function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger
        className="-ml-1.5 rounded-md p-1.5 text-ink-muted hover:bg-sunken"
        aria-label="Open navigation"
      >
        <MenuIcon size={20} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Drawer.Content
          aria-describedby={undefined}
          // Close the drawer once a navigation link is chosen.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) setOpen(false);
          }}
          className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar focus:outline-none"
        >
          <Drawer.Title className="sr-only">Navigation</Drawer.Title>
          <SidebarContent />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function StaffShell() {
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-sidebar max-md:hidden">
        <SidebarContent />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:hidden">
          <MobileNav />
          <img src="/favicon.svg" alt="" className="size-5" />
          <span className="font-semibold">DeviceFlow</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
