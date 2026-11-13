import { useState } from 'react';
import { Link } from 'react-router';
import { Laptop, SearchX } from 'lucide-react';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  type AssetStatus,
} from '@deviceflow/shared';
import { PageHeader, Panel, table } from '../../design/Page';
import { FilterInput, FilterSelect } from '../../design/Field';
import { EmptyState, ErrorState, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { useDebounced } from '../../lib/hooks';
import { formatDate, todayIso } from '../../lib/format';
import { AssetStatusBadge } from '../../lib/status';
import { usePortalAccount, usePortalAssets } from './api';

export function PortalDevicesPage() {
  const account = usePortalAccount();
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState<AssetStatus | ''>('');
  const [page, setPage] = useState(1);
  const search = useDebounced(searchInput.trim());
  const assets = usePortalAssets({ search, status, page });
  const today = todayIso();
  const filtered = search !== '' || status !== '';

  return (
    <>
      <PageHeader
        title="My devices"
        description={
          account.data
            ? `Devices registered to ${account.data.name} (account ${account.data.accountNumber}).`
            : 'Devices registered to your account.'
        }
      />
      <Panel>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
          role="search"
        >
          <FilterInput
            type="search"
            aria-label="Search devices"
            placeholder="Asset tag, serial, make or model"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            className="w-72 max-sm:w-full"
          />
          <FilterSelect
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AssetStatus | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'Any status' },
              ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
            ]}
          />
        </div>
        {assets.isPending ? (
          <TableSkeleton columns={4} />
        ) : assets.isError ? (
          <ErrorState error={assets.error} onRetry={() => assets.refetch()} />
        ) : assets.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No devices match"
              description="Try a different search or status."
            />
          ) : (
            <EmptyState
              icon={Laptop}
              title="No devices registered yet"
              description="When your service provider registers a device for you, it appears here."
            />
          )
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th className={table.th} scope="col">
                    Device
                  </th>
                  <th className={`${table.th} max-sm:hidden`} scope="col">
                    Serial
                  </th>
                  <th className={table.th} scope="col">
                    Status
                  </th>
                  <th className={table.th} scope="col">
                    Warranty
                  </th>
                </tr>
              </thead>
              <tbody className={assets.isPlaceholderData ? 'opacity-60' : undefined}>
                {assets.data.data.map((a) => (
                  <tr key={a.id} className={table.row}>
                    <td className={table.td}>
                      <Link
                        to={`/portal/devices/${a.id}`}
                        className="font-medium text-ink hover:text-accent hover:underline"
                      >
                        {a.manufacturer} {a.model}
                      </Link>
                      <div className="text-[13px] text-ink-muted">
                        <span className="font-mono whitespace-nowrap">{a.assetTag}</span> ·{' '}
                        {ASSET_CATEGORY_LABELS[a.category]}
                      </div>
                    </td>
                    <td
                      className={`${table.td} font-mono text-[13px] text-ink-muted max-sm:hidden`}
                    >
                      {a.serialNumber ?? '—'}
                    </td>
                    <td className={table.td}>
                      <AssetStatusBadge status={a.status} />
                    </td>
                    <td className={`${table.td} text-[13px] whitespace-nowrap`}>
                      {a.warrantyExpiresOn
                        ? `${a.warrantyExpiresOn < today ? 'Ended' : 'Until'} ${formatDate(a.warrantyExpiresOn)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={assets.data?.meta} onPage={setPage} />
      </Panel>
    </>
  );
}
