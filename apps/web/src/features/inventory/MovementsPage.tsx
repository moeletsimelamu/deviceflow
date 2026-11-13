import { useState } from 'react';
import { History, SearchX } from 'lucide-react';
import { STOCK_MOVEMENT_TYPE_LABELS, STOCK_MOVEMENT_TYPES } from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { PageHeader, Panel } from '../../design/Page';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { useCurrency } from '../../lib/settings';
import { useMovements, type MovementFilters } from './api';
import { InventoryTabs } from './InventoryPage';
import { MovementTable } from './MovementTable';

/** The stock ledger for every part. Entries are permanent: corrections are new entries. */
export function MovementsPage() {
  const currency = useCurrency();
  const canOpenJobs = useCan('repairs:read');
  const [filters, setFilters] = useState<MovementFilters>({ type: '', from: '', to: '', page: 1 });
  const movements = useMovements(filters);
  const set = (patch: Partial<MovementFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = filters.type !== '' || filters.from !== '' || filters.to !== '';

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every delivery, adjustment and repair use, newest first. Entries cannot be edited."
      />
      <InventoryTabs />
      <Panel>
        <div
          className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <FilterSelect
            aria-label="Filter by movement"
            value={filters.type}
            onChange={(e) => set({ type: e.target.value as MovementFilters['type'] })}
            options={[
              { value: '', label: 'Any movement' },
              ...STOCK_MOVEMENT_TYPES.map((t) => ({
                value: t,
                label: STOCK_MOVEMENT_TYPE_LABELS[t],
              })),
            ]}
          />
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            From
            <FilterInput
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            To
            <FilterInput
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
            />
          </label>
        </div>
        {movements.isPending ? (
          <TableSkeleton columns={6} />
        ) : movements.isError ? (
          <ErrorState error={movements.error} onRetry={() => movements.refetch()} />
        ) : movements.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No movements match"
              description="Try a different movement type or dates."
            />
          ) : (
            <EmptyState
              icon={History}
              title="No stock movements yet"
              description="Deliveries, adjustments and parts used on repairs are listed here."
            />
          )
        ) : (
          <MovementTable
            movements={movements.data.data}
            currency={currency}
            linkJobs={canOpenJobs}
            dimmed={movements.isPlaceholderData}
          />
        )}
        <Pagination meta={movements.data?.meta} onPage={(page) => set({ page })} />
      </Panel>
    </>
  );
}
