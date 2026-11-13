import { NavLink, Outlet } from 'react-router';
import { LogOut } from 'lucide-react';
import { useCurrentUser, useLogout } from '../features/auth/session';
import { usePortalAccount } from '../features/portal/api';
import { Button } from '../design/Button';
import { cn } from '../design/cn';

/**
 * The customer portal layout. Lighter than the staff app: a top bar with the
 * customer's account, and room for the sections that arrive in later phases
 * (repair requests and quotations in Phase 4).
 */
export function PortalShell() {
  const user = useCurrentUser();
  const account = usePortalAccount();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-4 px-4 max-sm:gap-2 md:px-8">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="font-semibold tracking-tight">DeviceFlow</span>
            <span className="text-ink-subtle max-sm:hidden">/</span>
            <span className="truncate text-sm text-ink-muted max-sm:hidden">
              {account.data?.name ?? ' '}
            </span>
          </div>
          <nav aria-label="Portal" className="ml-4 flex gap-1 max-sm:ml-0 max-sm:gap-0">
            <NavLink
              to="/portal"
              end
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap',
                  isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-sunken',
                )
              }
            >
              My devices
            </NavLink>
            <NavLink
              to="/portal/repairs"
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap',
                  isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-sunken',
                )
              }
            >
              My repairs
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[13px] text-ink-muted max-md:hidden">{user.fullName}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => logout.mutate()}
              aria-label="Sign out"
              loading={logout.isPending}
            >
              <LogOut size={14} aria-hidden="true" />{' '}
              <span className="max-sm:sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
