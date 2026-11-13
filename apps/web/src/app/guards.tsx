import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { isStaffRole, type Permission } from '@deviceflow/shared';
import { ShieldOff } from 'lucide-react';
import { useCan, useSession } from '../features/auth/session';
import { EmptyState, ErrorState, Spinner } from '../design/States';

function FullPageSpinner() {
  return (
    <div
      className="grid min-h-screen place-items-center text-ink-subtle"
      role="status"
      aria-label="Loading"
    >
      <Spinner size={22} />
    </div>
  );
}

/** Shared handling for loading, failure and signed-out states of a protected area. */
function SessionGate({ area, children }: { area: 'staff' | 'portal'; children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullPageSpinner />;
  if (session.isError)
    return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
  if (!session.data) {
    const next = location.pathname + location.search;
    return (
      <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
    );
  }
  // Each kind of user has one home; the API refuses the other area anyway.
  const isStaff = isStaffRole(session.data.role);
  if (area === 'staff' && !isStaff) return <Navigate to="/portal" replace />;
  if (area === 'portal' && isStaff) return <Navigate to="/" replace />;
  return children;
}

export function RequireStaff({ children }: { children: ReactNode }) {
  return <SessionGate area="staff">{children}</SessionGate>;
}

export function RequireCustomer({ children }: { children: ReactNode }) {
  return <SessionGate area="portal">{children}</SessionGate>;
}

export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending) return <FullPageSpinner />;
  if (session.data)
    return <Navigate to={isStaffRole(session.data.role) ? '/' : '/portal'} replace />;
  return children;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  if (!allowed) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You don't have access to this page"
        description="Ask an administrator if you need access."
      />
    );
  }
  return children;
}
