import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, SearchX, Wrench } from 'lucide-react';
import { REPAIR_STATUS_LABELS, REPAIR_STATUSES, type Repair } from '@deviceflow/shared';
import { useCan, useCurrentUser } from '../auth/session';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { cn } from '../../design/cn';
import { useDebounced } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { RepairStatusBadge } from '../../lib/status';
import { useRepairs, useTechnicians, type RepairFilters } from './api';
import { NewRepairDialog } from './RepairDialogs';

const SORTS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'updatedAt:desc', label: 'Recently changed' },
  { value: 'status:asc', label: 'Status' },
];

const STATES: Array<{ value: RepairFilters['state']; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Finished' },
  { value: '', label: 'All' },
];

/** The repair list used on the Repairs page and on asset and customer pages. */
export function RepairTable({
  repairs,
  dimmed,
  showCustomer = true,
  showDevice = true,
  compact = false,
}: {
  repairs: Repair[];
  dimmed?: boolean;
  showCustomer?: boolean;
  showDevice?: boolean;
  /** For panels inside a record page: drops the opened date and shortens the fault. */
  compact?: boolean;
}) {
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={table.th} scope="col">
              Job
            </th>
            {showDevice && (
              <th className={cn(table.th, 'max-md:hidden')} scope="col">
                Device
              </th>
            )}
            {showCustomer && (
              <th className={cn(table.th, 'max-md:hidden')} scope="col">
                Customer
              </th>
            )}
            <th className={table.th} scope="col">
              Status
            </th>
            <th className={cn(table.th, 'max-sm:hidden')} scope="col">
              Technician
            </th>
            {!compact && (
              <th className={cn(table.th, 'max-lg:hidden')} scope="col">
                Opened
              </th>
            )}
          </tr>
        </thead>
        <tbody className={dimmed ? 'opacity-60' : undefined}>
          {repairs.map((r) => (
            <tr key={r.id} className={table.row}>
              <td className={table.td}>
                <Link
                  to={`/repairs/${r.id}`}
                  className="font-mono font-medium whitespace-nowrap text-ink hover:text-accent hover:underline"
                >
                  {r.reference}
                </Link>
                {showDevice && (
                  <p className="text-[13px] md:hidden">
                    {r.asset.manufacturer} {r.asset.model}
                  </p>
                )}
                <p
                  className={cn(
                    'truncate text-[13px] text-ink-muted',
                    compact ? 'max-w-[220px]' : 'max-w-[260px] max-sm:max-w-[180px]',
                  )}
                >
                  {r.faultDescription}
                </p>
              </td>
              {showDevice && (
                <td className={cn(table.td, 'max-md:hidden')}>
                  <span className="block whitespace-nowrap">
                    {r.asset.manufacturer} {r.asset.model}
                  </span>
                  <span className="font-mono text-[12px] text-ink-subtle">{r.asset.assetTag}</span>
                </td>
              )}
              {showCustomer && <td className={cn(table.td, 'max-md:hidden')}>{r.customer.name}</td>}
              <td className={table.td}>
                <RepairStatusBadge status={r.status} />
              </td>
              <td className={cn(table.td, 'whitespace-nowrap max-sm:hidden')}>
                {r.technician?.fullName ?? <span className="text-ink-subtle">Unassigned</span>}
              </td>
              {!compact && (
                <td
                  className={cn(
                    table.td,
                    'text-[13px] whitespace-nowrap text-ink-muted max-lg:hidden',
                  )}
                >
                  {formatDateTime(r.createdAt)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RepairsPage() {
  const canManage = useCan('repairs:manage');
  const user = useCurrentUser();
  const inventoryView = user.role === 'INVENTORY_MANAGER';
  const [searchInput, setSearchInput] = useState('');
  const [base, setBase] = useState<Omit<RepairFilters, 'search'>>({
    state: 'open',
    status: '',
    technician: '',
    page: 1,
    sort: 'createdAt:desc',
  });
  const filters: RepairFilters = { ...base, search: useDebounced(searchInput.trim()) };
  const repairs = useRepairs(filters);
  const technicians = useTechnicians(canManage);
  const [creating, setCreating] = useState(false);
  const set = (patch: Partial<Omit<RepairFilters, 'search'>>) =>
    setBase((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = filters.search !== '' || filters.status !== '' || filters.technician !== '';

  return (
    <>
      <PageHeader
        title="Repairs"
        description={
          canManage
            ? 'Every repair job, from booking in to handing the device back.'
            : inventoryView
              ? 'Repair jobs that have used parts from stock.'
              : 'Repair jobs assigned to you.'
        }
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> Book in a repair
            </Button>
          )
        }
      />
      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <div
            className="flex rounded-md border border-line-strong p-0.5"
            role="group"
            aria-label="Show"
          >
            {STATES.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-pressed={base.state === s.value}
                onClick={() => set({ state: s.value, status: '' })}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[13px] font-medium',
                  base.state === s.value
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-sunken',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <FilterInput
            type="search"
            aria-label="Search repairs"
            placeholder="Job, device, serial, customer or fault"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              set({});
            }}
            className="w-72 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by status"
            value={base.status}
            onChange={(e) => set({ status: e.target.value as RepairFilters['status'], state: '' })}
            options={[
              { value: '', label: 'Any status' },
              ...REPAIR_STATUSES.map((s) => ({ value: s, label: REPAIR_STATUS_LABELS[s] })),
            ]}
          />
          {canManage && (
            <FilterSelect
              aria-label="Filter by technician"
              value={base.technician}
              onChange={(e) => set({ technician: e.target.value })}
              options={[
                { value: '', label: 'Any technician' },
                { value: 'unassigned', label: 'Unassigned' },
                ...(technicians.data ?? []).map((t) => ({ value: t.id, label: t.fullName })),
              ]}
            />
          )}
          <FilterSelect
            aria-label="Sort"
            value={base.sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORTS}
            className="ml-auto max-sm:ml-0"
          />
        </div>
        {repairs.isPending ? (
          <TableSkeleton columns={5} />
        ) : repairs.isError ? (
          <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />
        ) : repairs.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No repairs match"
              description="Try a different search or filter."
            />
          ) : (
            <EmptyState
              icon={Wrench}
              title={base.state === 'open' ? 'No open repairs' : 'No repairs yet'}
              description={
                canManage
                  ? 'Book a customer device in to start a repair job.'
                  : inventoryView
                    ? 'Jobs appear here once a technician uses parts on them.'
                    : 'Jobs appear here when an administrator assigns them to you.'
              }
              action={
                canManage && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={14} aria-hidden="true" /> Book in a repair
                  </Button>
                )
              }
            />
          )
        ) : (
          <RepairTable repairs={repairs.data.data} dimmed={repairs.isPlaceholderData} />
        )}
        <Pagination meta={repairs.data?.meta} onPage={(page) => set({ page })} />
      </Panel>
      <NewRepairDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
