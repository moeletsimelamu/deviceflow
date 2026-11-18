import { Link } from 'react-router';
import { ROLE_LABELS } from '@deviceflow/shared';
import { useCan, useCurrentUser } from '../auth/session';
import { PageHeader, Panel, PanelHeader } from '../../design/Page';
import { Badge } from '../../design/Badge';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '../../design/States';
import { StockStateBadge } from '../../lib/status';
import { useParts } from '../inventory/api';
import { useRepairs } from '../repairs/api';
import { RepairTable } from '../repairs/RepairsPage';
import { Wrench } from 'lucide-react';

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** Active parts at or below their reorder level (Phase 1: computed in the query, no background job). */
function LowStockPanel() {
  const low = useParts(
    { search: '', category: '', stock: 'low', isActive: true, page: 1, sort: 'quantityOnHand:asc' },
    5,
  );
  const total = low.data?.meta.total ?? 0;
  return (
    <Panel className="self-start">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-semibold">Low stock</h2>
        {total > 0 && <Badge tone="warning">{total}</Badge>}
      </div>
      {low.isPending ? (
        <Skeleton className="m-5 h-10" />
      ) : low.isError ? (
        <ErrorState error={low.error} onRetry={() => low.refetch()} />
      ) : total === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-muted">
          Every part is above its reorder level.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {low.data.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <Link
                  to={`/inventory/parts/${p.id}`}
                  className="min-w-0 truncate text-sm hover:text-accent hover:underline"
                >
                  {p.name}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <StockStateBadge state={p.stockState} />
                  <span className="text-sm font-medium tabular-nums">{p.quantityOnHand}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/inventory?stock=low"
            className="block border-t border-line px-5 py-3 text-sm font-medium text-accent hover:underline"
          >
            {total > low.data.data.length ? `All ${total} low-stock parts →` : 'Open inventory →'}
          </Link>
        </>
      )}
    </Panel>
  );
}

/**
 * The open jobs changed most recently. The API scopes the list by role: technicians
 * get only their own jobs, inventory managers only jobs with parts used.
 */
function OpenRepairsPanel({ showReportsLink }: { showReportsLink: boolean }) {
  const repairs = useRepairs(
    { search: '', state: 'open', status: '', technician: '', page: 1, sort: 'updatedAt:desc' },
    5,
  );
  const total = repairs.data?.meta.total ?? 0;
  return (
    <Panel className="self-start">
      <PanelHeader
        title="Open repairs"
        description={
          showReportsLink ? (
            <>
              Revenue, turnaround and stock figures are on the{' '}
              <Link to="/reports" className="font-medium text-accent hover:underline">
                Reports
              </Link>{' '}
              page.
            </>
          ) : (
            'The open jobs changed most recently.'
          )
        }
        actions={total > 0 && <Badge tone="info">{total}</Badge>}
      />
      {repairs.isPending ? (
        <TableSkeleton columns={4} rows={3} />
      ) : repairs.isError ? (
        <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No open repairs"
          description="Nothing is waiting on the workshop."
        />
      ) : (
        <>
          <RepairTable repairs={repairs.data.data} showDevice={false} compact />
          <Link
            to="/repairs"
            className="block border-t border-line px-5 py-3 text-sm font-medium text-accent hover:underline"
          >
            {total > repairs.data.data.length ? `All ${total} open repairs →` : 'All repairs →'}
          </Link>
        </>
      )}
    </Panel>
  );
}

export function DashboardPage() {
  const user = useCurrentUser();
  const canManageUsers = useCan('users:manage');
  const canSeeStock = useCan('inventory:read');
  const canSeeReports = useCan('reports:inventory');
  const firstName = user.fullName.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          <>
            Signed in as <Badge tone="accent">{ROLE_LABELS[user.role]}</Badge>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <OpenRepairsPanel showReportsLink={canSeeReports} />

        <div className="space-y-5">
          {canSeeStock && <LowStockPanel />}
          {canManageUsers && (
            <Panel>
              <div className="px-5 py-4">
                <h2 className="text-sm font-semibold">Administration</h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Create staff accounts and set the company currency and VAT rate used on
                  quotations.
                </p>
                <div className="mt-4 flex flex-col gap-2 text-sm">
                  <Link to="/admin/users" className="font-medium text-accent hover:underline">
                    Manage users →
                  </Link>
                  <Link to="/admin/settings" className="font-medium text-accent hover:underline">
                    Company settings →
                  </Link>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
