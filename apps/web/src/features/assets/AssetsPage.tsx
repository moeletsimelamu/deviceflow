import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Laptop, Plus, SearchX } from 'lucide-react';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  type Asset,
} from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { useDebounced } from '../../lib/hooks';
import { formatDate, todayIso } from '../../lib/format';
import { AssetStatusBadge } from '../../lib/status';
import { downloadAssetExport, useAssets, type AssetFilters } from './api';
import { AssetFormDialog } from './AssetDialogs';

const SORTS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'assetTag:asc', label: 'Asset tag' },
  { value: 'manufacturer:asc', label: 'Manufacturer' },
  { value: 'model:asc', label: 'Model' },
  { value: 'status:asc', label: 'Status' },
  { value: 'warrantyExpiresOn:asc', label: 'Warranty ending soonest' },
];

export function AssetsPage() {
  const canManage = useCan('assets:manage');
  const canExport = useCan('assets:export');
  const [searchInput, setSearchInput] = useState('');
  const [base, setBase] = useState<Omit<AssetFilters, 'search'>>({
    status: '',
    category: '',
    customer: '',
    warranty: '',
    page: 1,
    sort: 'createdAt:desc',
  });
  const filters: AssetFilters = { ...base, search: useDebounced(searchInput.trim()) };
  const assets = useAssets(filters);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const today = todayIso();

  const set = (patch: Partial<Omit<AssetFilters, 'search'>>) =>
    setBase((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered =
    filters.search !== '' ||
    filters.status !== '' ||
    filters.category !== '' ||
    filters.customer !== '' ||
    filters.warranty !== '';

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadAssetExport(filters);
    } catch (err) {
      setExportError(err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Assets"
        description="Every registered device, who it belongs to and where it is in its lifecycle."
        actions={
          <>
            {canExport && (
              <Button
                onClick={runExport}
                loading={exporting}
                disabled={assets.data?.meta.total === 0}
              >
                <Download size={16} aria-hidden="true" /> Export CSV
              </Button>
            )}
            {canManage && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" /> Register asset
              </Button>
            )}
          </>
        }
      />
      {exportError !== null && (
        <div className="mb-4">
          <FormError error={exportError} />
        </div>
      )}

      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <FilterInput
            type="search"
            aria-label="Search assets"
            placeholder="Tag, serial, make, model or customer"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              set({ page: 1 });
            }}
            className="w-72 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by status"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as AssetFilters['status'] })}
            options={[
              { value: '', label: 'Any status' },
              ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
            ]}
          />
          <FilterSelect
            aria-label="Filter by category"
            value={filters.category}
            onChange={(e) => set({ category: e.target.value as AssetFilters['category'] })}
            options={[
              { value: '', label: 'All categories' },
              ...ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] })),
            ]}
          />
          <FilterSelect
            aria-label="Filter by owner"
            value={filters.customer === 'none' ? 'none' : ''}
            onChange={(e) => set({ customer: e.target.value })}
            options={[
              { value: '', label: 'Any owner' },
              { value: 'none', label: 'Company stock (no customer)' },
            ]}
          />
          <FilterSelect
            aria-label="Filter by warranty"
            value={filters.warranty}
            onChange={(e) => set({ warranty: e.target.value as AssetFilters['warranty'] })}
            options={[
              { value: '', label: 'Any warranty' },
              { value: 'active', label: 'In warranty' },
              { value: 'expired', label: 'Warranty expired' },
              { value: 'none', label: 'No warranty recorded' },
            ]}
          />
          <FilterSelect
            aria-label="Sort"
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value })}
            options={SORTS}
            className="ml-auto max-lg:ml-0"
          />
        </div>

        {assets.isPending ? (
          <TableSkeleton columns={5} />
        ) : assets.isError ? (
          <ErrorState error={assets.error} onRetry={() => assets.refetch()} />
        ) : assets.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No assets match these filters"
              description="Try a different search or clear the filters."
            />
          ) : (
            <EmptyState
              icon={Laptop}
              title="No assets registered yet"
              description="Register a device to give it an asset tag and start its history."
              action={
                canManage && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Register asset
                  </Button>
                )
              }
            />
          )
        ) : (
          <AssetTable assets={assets.data.data} today={today} dimmed={assets.isPlaceholderData} />
        )}
        <Pagination meta={assets.data?.meta} onPage={(page) => set({ page })} />
      </Panel>

      <AssetFormDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function AssetTable({
  assets,
  today,
  dimmed,
  showCustomer = true,
}: {
  assets: Asset[];
  today: string;
  dimmed?: boolean;
  showCustomer?: boolean;
}) {
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={table.th} scope="col">
              Asset
            </th>
            <th className={table.th} scope="col">
              Serial
            </th>
            {showCustomer && (
              <th className={table.th} scope="col">
                Customer
              </th>
            )}
            <th className={table.th} scope="col">
              Status
            </th>
            <th className={table.th} scope="col">
              Warranty
            </th>
          </tr>
        </thead>
        <tbody className={dimmed ? 'opacity-60' : undefined}>
          {assets.map((a) => (
            <tr key={a.id} className={table.row}>
              <td className={table.td}>
                <Link
                  to={`/assets/${a.id}`}
                  className="font-mono text-[13px] font-medium whitespace-nowrap text-ink hover:text-accent hover:underline"
                >
                  {a.assetTag}
                </Link>
                <div className="text-[13px] text-ink-muted">
                  {a.manufacturer} {a.model}
                  <span className="text-ink-subtle"> · {ASSET_CATEGORY_LABELS[a.category]}</span>
                </div>
              </td>
              <td className={`${table.td} font-mono text-[13px] text-ink-muted`}>
                {a.serialNumber ?? <span className="font-sans text-ink-subtle">None</span>}
              </td>
              {showCustomer && (
                <td className={`${table.td} text-[13px]`}>
                  {a.customer ? (
                    a.customer.name
                  ) : (
                    <span className="text-ink-subtle">Company stock</span>
                  )}
                </td>
              )}
              <td className={table.td}>
                <AssetStatusBadge status={a.status} />
              </td>
              <td className={`${table.td} tabular text-[13px] whitespace-nowrap`}>
                {a.warrantyExpiresOn ? (
                  <span className={a.warrantyExpiresOn < today ? 'text-ink-subtle' : 'text-ink'}>
                    {a.warrantyExpiresOn < today ? 'Ended ' : 'Until '}
                    {formatDate(a.warrantyExpiresOn)}
                  </span>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
