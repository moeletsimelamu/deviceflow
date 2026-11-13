import { useState } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { AlertTriangle, Boxes, Plus, SearchX } from 'lucide-react';
import { PART_CATEGORIES, PART_CATEGORY_LABELS, type Part } from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { cn } from '../../design/cn';
import { formatMoney } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { useCurrency } from '../../lib/settings';
import { StockStateBadge } from '../../lib/status';
import { useParts, type PartFilters } from './api';
import { PartFormDialog } from './PartDialogs';

const SORTS = [
  { value: 'name:asc', label: 'Name' },
  { value: 'sku:asc', label: 'SKU' },
  { value: 'quantityOnHand:asc', label: 'Least in stock' },
  { value: 'updatedAt:desc', label: 'Recently changed' },
];

const STOCK_FILTERS: Array<{ value: PartFilters['stock']; label: string }> = [
  { value: '', label: 'All' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
];

/** Parts | Stock movements, shown at the top of both inventory pages. */
export function InventoryTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      '-mb-px border-b-2 px-1 pb-2 text-sm font-medium',
      isActive ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
    );
  return (
    <nav aria-label="Inventory" className="mb-5 flex gap-5 border-b border-line">
      <NavLink to="/inventory" end className={tab}>
        Parts
      </NavLink>
      <NavLink to="/inventory/movements" className={tab}>
        Stock movements
      </NavLink>
    </nav>
  );
}

function PartTable({ parts, dimmed }: { parts: Part[]; dimmed?: boolean }) {
  const currency = useCurrency();
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={table.th} scope="col">
              Part
            </th>
            <th className={cn(table.th, 'max-lg:hidden')} scope="col">
              Category
            </th>
            <th className={cn(table.th, 'max-md:hidden')} scope="col">
              Location
            </th>
            <th className={cn(table.th, 'text-right')} scope="col">
              In stock
            </th>
            <th className={cn(table.th, 'text-right max-sm:hidden')} scope="col">
              Reorder at
            </th>
            <th className={cn(table.th, 'text-right max-md:hidden')} scope="col">
              Average cost
            </th>
          </tr>
        </thead>
        <tbody className={dimmed ? 'opacity-60' : undefined}>
          {parts.map((p) => (
            <tr key={p.id} className={table.row}>
              <td className={cn(table.td, 'py-2')}>
                <Link
                  to={`/inventory/parts/${p.id}`}
                  className="block max-w-[320px] truncate font-medium text-ink hover:text-accent hover:underline max-sm:max-w-[170px]"
                >
                  {p.name}
                </Link>
                <span className="font-mono text-[12px] text-ink-subtle">{p.sku}</span>
              </td>
              <td className={cn(table.td, 'text-[13px] text-ink-muted max-lg:hidden')}>
                {PART_CATEGORY_LABELS[p.category]}
              </td>
              <td className={cn(table.td, 'font-mono text-[13px] max-md:hidden')}>
                {p.location ?? <span className="text-ink-subtle">—</span>}
              </td>
              <td className={cn(table.td, 'text-right')}>
                <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                  {p.isActive && p.stockState !== 'OK' && <StockStateBadge state={p.stockState} />}
                  <span className="font-medium tabular-nums">{p.quantityOnHand}</span>
                </div>
              </td>
              <td className={cn(table.td, 'text-right tabular-nums text-ink-muted max-sm:hidden')}>
                {p.reorderLevel}
              </td>
              <td
                className={cn(table.td, 'text-right tabular-nums whitespace-nowrap max-md:hidden')}
              >
                {formatMoney(p.averageCostCents, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const canManage = useCan('inventory:manage');
  const [params] = useSearchParams();
  const initialStock = params.get('stock');
  const [searchInput, setSearchInput] = useState('');
  const [base, setBase] = useState<Omit<PartFilters, 'search'>>({
    category: '',
    stock: initialStock === 'low' || initialStock === 'out' ? initialStock : '',
    isActive: true,
    page: 1,
    sort: 'name:asc',
  });
  const filters: PartFilters = { ...base, search: useDebounced(searchInput.trim()) };
  const parts = useParts(filters);
  // A count of every active part at or below its reorder level, whatever the filters.
  const low = useParts(
    { search: '', category: '', stock: 'low', isActive: true, page: 1, sort: 'name:asc' },
    1,
  );
  const [creating, setCreating] = useState(false);
  const set = (patch: Partial<Omit<PartFilters, 'search'>>) =>
    setBase((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = filters.search !== '' || filters.category !== '' || filters.stock !== '';
  const lowCount = low.data?.meta.total ?? 0;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Spare parts and consumables, with every stock movement on record."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> Add part
            </Button>
          )
        }
      />
      <InventoryTabs />

      {lowCount > 0 && base.stock !== 'low' && base.isActive && (
        <div
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning-fg/30 bg-warning-bg px-4 py-2.5 text-sm text-warning-fg"
          role="status"
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="flex-1">
            {lowCount} {lowCount === 1 ? 'part is' : 'parts are'} at or below the reorder level.
          </span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => set({ stock: 'low' })}
          >
            Show {lowCount === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <div
            className="flex rounded-md border border-line-strong p-0.5"
            role="group"
            aria-label="Stock level"
          >
            {STOCK_FILTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-pressed={base.stock === s.value}
                onClick={() => set({ stock: s.value })}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[13px] font-medium whitespace-nowrap',
                  base.stock === s.value
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
            aria-label="Search parts"
            placeholder="SKU, name or location"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              set({});
            }}
            className="w-64 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by category"
            value={base.category}
            onChange={(e) => set({ category: e.target.value as PartFilters['category'] })}
            options={[
              { value: '', label: 'Any category' },
              ...PART_CATEGORIES.map((c) => ({ value: c, label: PART_CATEGORY_LABELS[c] })),
            ]}
          />
          <FilterSelect
            aria-label="Active or archived"
            value={base.isActive ? 'active' : 'archived'}
            onChange={(e) => set({ isActive: e.target.value === 'active' })}
            options={[
              { value: 'active', label: 'Active parts' },
              { value: 'archived', label: 'Archived parts' },
            ]}
          />
          <FilterSelect
            aria-label="Sort"
            value={base.sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORTS}
            className="ml-auto max-sm:ml-0"
          />
        </div>
        {parts.isPending ? (
          <TableSkeleton columns={5} />
        ) : parts.isError ? (
          <ErrorState error={parts.error} onRetry={() => parts.refetch()} />
        ) : parts.data.data.length === 0 ? (
          filtered || !base.isActive ? (
            <EmptyState
              icon={SearchX}
              title={base.stock ? 'Nothing is running low' : 'No parts match'}
              description={
                base.stock
                  ? 'Every active part is above its reorder level.'
                  : 'Try a different search or filter.'
              }
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="No parts yet"
              description={
                canManage
                  ? 'Add the parts you keep in stock, then receive deliveries against them.'
                  : 'Parts appear here when an inventory manager adds them.'
              }
              action={
                canManage && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={14} aria-hidden="true" /> Add part
                  </Button>
                )
              }
            />
          )
        ) : (
          <PartTable parts={parts.data.data} dimmed={parts.isPlaceholderData} />
        )}
        <Pagination meta={parts.data?.meta} onPage={(page) => set({ page })} />
      </Panel>
      <PartFormDialog part={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}
