import { useState } from 'react';
import { Link } from 'react-router';
import { Building2, Plus, SearchX } from 'lucide-react';
import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES } from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { Badge } from '../../design/Badge';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { useDebounced } from '../../lib/hooks';
import { CustomerTypeBadge } from '../../lib/status';
import { useCustomers, type CustomerFilters } from './api';
import { CustomerFormDialog } from './CustomerDialogs';

const SORTS = [
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'accountNumber:asc', label: 'Account number' },
  { value: 'createdAt:desc', label: 'Newest first' },
];

export function CustomersPage() {
  const canManage = useCan('customers:manage');
  const [searchInput, setSearchInput] = useState('');
  const [base, setBase] = useState<Omit<CustomerFilters, 'search'>>({
    type: '',
    status: 'active',
    page: 1,
    sort: 'name:asc',
  });
  const filters: CustomerFilters = { ...base, search: useDebounced(searchInput.trim()) };
  const customers = useCustomers(filters);
  const [creating, setCreating] = useState(false);

  const set = (patch: Partial<Omit<CustomerFilters, 'search'>>) =>
    setBase((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = filters.search !== '' || filters.type !== '' || filters.status !== 'active';

  return (
    <>
      <PageHeader
        title="Customers"
        description="Individuals and organisations whose devices you look after."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" /> New customer
            </Button>
          )
        }
      />

      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <FilterInput
            type="search"
            aria-label="Search customers"
            placeholder="Name, account number, email or contact"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              set({ page: 1 });
            }}
            className="w-80 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by type"
            value={filters.type}
            onChange={(e) => set({ type: e.target.value as CustomerFilters['type'] })}
            options={[
              { value: '', label: 'All types' },
              ...CUSTOMER_TYPES.map((t) => ({ value: t, label: CUSTOMER_TYPE_LABELS[t] })),
            ]}
          />
          <FilterSelect
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as CustomerFilters['status'] })}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: '', label: 'Active and archived' },
            ]}
          />
          <FilterSelect
            aria-label="Sort"
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORTS}
            className="ml-auto max-sm:ml-0"
          />
        </div>

        {customers.isPending ? (
          <TableSkeleton columns={4} />
        ) : customers.isError ? (
          <ErrorState error={customers.error} onRetry={() => customers.refetch()} />
        ) : customers.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No customers match these filters"
              description="Try a different search or clear the filters."
            />
          ) : (
            <EmptyState
              icon={Building2}
              title="No customers yet"
              description="Add the schools, businesses and people whose devices you service."
              action={
                canManage && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    New customer
                  </Button>
                )
              }
            />
          )
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th className={table.th} scope="col">
                    Customer
                  </th>
                  <th className={table.th} scope="col">
                    Account
                  </th>
                  <th className={table.th} scope="col">
                    Type
                  </th>
                  <th className={table.th} scope="col">
                    Contact
                  </th>
                  <th className={`${table.th} text-right`} scope="col">
                    Devices
                  </th>
                </tr>
              </thead>
              <tbody className={customers.isPlaceholderData ? 'opacity-60' : undefined}>
                {customers.data.data.map((c) => (
                  <tr key={c.id} className={table.row}>
                    <td className={table.td}>
                      <Link
                        to={`/customers/${c.id}`}
                        className="font-medium text-ink hover:text-accent hover:underline"
                      >
                        {c.name}
                      </Link>
                      {!c.isActive && (
                        <span className="ml-2">
                          <Badge tone="neutral">Archived</Badge>
                        </span>
                      )}
                      {c.city && <div className="text-[13px] text-ink-muted">{c.city}</div>}
                    </td>
                    <td className={`${table.td} font-mono text-[13px] text-ink-muted`}>
                      {c.accountNumber}
                    </td>
                    <td className={table.td}>
                      <CustomerTypeBadge type={c.type} />
                    </td>
                    <td className={`${table.td} text-[13px] text-ink-muted`}>
                      {c.email ?? c.phone ?? <span className="text-ink-subtle">—</span>}
                    </td>
                    <td className={`${table.td} tabular text-right`}>{c.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={customers.data?.meta} onPage={(page) => set({ page })} />
      </Panel>

      <CustomerFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
