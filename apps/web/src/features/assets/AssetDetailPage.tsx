import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, History, Laptop, Pencil, RefreshCw, Wrench } from 'lucide-react';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_TRANSITIONS,
  isRepairOpen,
  type Asset,
  type AssetEvent,
} from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { DetailList, Panel, PanelHeader } from '../../design/Page';
import { Button } from '../../design/Button';
import { EmptyState, ErrorState, Skeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, todayIso } from '../../lib/format';
import { AssetStatusBadge, WarrantyBadge } from '../../lib/status';
import { ActivityFeed } from '../activity/ActivityFeed';
import { useAsset, useAssetEvents } from './api';
import { AssetFormDialog, AssetStatusDialog } from './AssetDialogs';
import { useRepairs } from '../repairs/api';
import { RepairTable } from '../repairs/RepairsPage';
import { NewRepairDialog } from '../repairs/RepairDialogs';

function describeEvent(e: AssetEvent): string {
  switch (e.type) {
    case 'REGISTERED':
      return `Registered as ${ASSET_STATUS_LABELS[e.toStatus ?? 'IN_STOCK'].toLowerCase()}${
        e.toCustomer ? ` for ${e.toCustomer.name}` : ' in company stock'
      }`;
    case 'STATUS_CHANGED':
      return `${ASSET_STATUS_LABELS[e.fromStatus ?? 'IN_STOCK']} → ${ASSET_STATUS_LABELS[e.toStatus ?? 'IN_STOCK']}`;
    case 'CUSTOMER_CHANGED':
      if (e.fromCustomer && e.toCustomer)
        return `Moved from ${e.fromCustomer.name} to ${e.toCustomer.name}`;
      return e.toCustomer
        ? `Assigned to ${e.toCustomer.name}`
        : `Returned to company stock from ${e.fromCustomer?.name ?? 'customer'}`;
    case 'DETAILS_UPDATED':
      return 'Details updated';
  }
}

function HistoryTimeline({ assetId }: { assetId: string }) {
  const events = useAssetEvents(assetId);
  if (events.isPending) {
    return (
      <div className="space-y-3 px-5 py-4" role="status" aria-label="Loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }
  if (events.isError) return <ErrorState error={events.error} onRetry={() => events.refetch()} />;
  if (events.data.length === 0) {
    return <EmptyState icon={History} title="No history" description="Nothing recorded yet." />;
  }
  return (
    <ol className="relative px-5 py-4">
      {events.data.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < events.data.length - 1 && (
            <span className="absolute top-3 bottom-0 left-[4px] w-px bg-line" aria-hidden="true" />
          )}
          <span
            className={`relative mt-1.5 size-[9px] shrink-0 rounded-full border-2 ${
              e.type === 'STATUS_CHANGED' || e.type === 'REGISTERED'
                ? 'border-accent bg-surface'
                : 'border-line-strong bg-surface'
            }`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{describeEvent(e)}</p>
            {e.note && <p className="mt-0.5 text-[13px] text-ink-muted">“{e.note}”</p>}
            <p className="mt-0.5 text-[12px] text-ink-subtle">
              {e.actor.fullName} · <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Repair jobs for this device, newest first, with a shortcut to book it in. */
function RepairsPanel({ asset, onBookIn }: { asset: Asset; onBookIn?: () => void }) {
  const [page, setPage] = useState(1);
  const repairs = useRepairs(
    {
      search: '',
      state: '',
      status: '',
      technician: '',
      asset: asset.id,
      page,
      sort: 'createdAt:desc',
    },
    5,
  );
  return (
    <Panel>
      <PanelHeader
        title="Repairs"
        actions={
          onBookIn && (
            <Button size="sm" onClick={onBookIn}>
              <Wrench size={13} aria-hidden="true" /> Book in for repair
            </Button>
          )
        }
      />
      {repairs.isPending ? (
        <Skeleton className="m-5 h-10" />
      ) : repairs.isError ? (
        <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : repairs.data.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          No repair jobs you can see for this device.
        </p>
      ) : (
        <>
          <RepairTable
            repairs={repairs.data.data}
            showDevice={false}
            showCustomer={false}
            compact
          />
          {repairs.data.meta.totalPages > 1 && (
            <Pagination meta={repairs.data.meta} onPage={setPage} />
          )}
        </>
      )}
    </Panel>
  );
}

function AssetBody({ asset }: { asset: Asset }) {
  const canManage = useCan('assets:manage');
  const canReadRepairs = useCan('repairs:read');
  const canBookIn = useCan('repairs:manage');
  const [bookingIn, setBookingIn] = useState(false);
  const openRepair = useRepairs(
    {
      search: '',
      state: 'open',
      status: '',
      technician: '',
      asset: asset.id,
      page: 1,
      sort: 'createdAt:desc',
    },
    1,
    canManage,
  ).data?.data[0];
  const canSeeCustomers = useCan('customers:read');
  const canSeeAudit = useCan('audit:read');
  const [editing, setEditing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const today = todayIso();
  const final = ASSET_TRANSITIONS[asset.status].length === 0;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight">{asset.assetTag}</h1>
            <AssetStatusBadge status={asset.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {asset.manufacturer} {asset.model} · {ASSET_CATEGORY_LABELS[asset.category]}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" /> Edit
            </Button>
            <Button
              variant="primary"
              onClick={() => setChangingStatus(true)}
              disabled={final || !!openRepair}
              title={openRepair ? `Its status follows repair ${openRepair.reference}` : undefined}
            >
              <RefreshCw size={14} aria-hidden="true" /> Change status
            </Button>
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Details" />
            <DetailList
              items={[
                ['Manufacturer', asset.manufacturer],
                ['Model', asset.model],
                [
                  'Serial number',
                  asset.serialNumber && <span className="font-mono">{asset.serialNumber}</span>,
                ],
                ['Category', ASSET_CATEGORY_LABELS[asset.category]],
                ['Condition', ASSET_CONDITION_LABELS[asset.condition]],
                ['Purchased', asset.purchaseDate && formatDate(asset.purchaseDate)],
                ['Registered', `${formatDateTime(asset.createdAt)} by ${asset.createdBy.fullName}`],
                ['Last changed', formatDateTime(asset.updatedAt)],
              ]}
            />
            {asset.notes && (
              <div className="border-t border-line px-5 py-4">
                <p className="text-[12px] font-medium text-ink-subtle">Internal notes</p>
                <p className="mt-0.5 text-sm whitespace-pre-line">{asset.notes}</p>
              </div>
            )}
          </Panel>

          {openRepair && isRepairOpen(openRepair.status) && (
            <p className="flex gap-2 rounded-md border border-line bg-canvas px-4 py-3 text-sm">
              <Wrench size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <span>
                In repair under{' '}
                <Link
                  to={`/repairs/${openRepair.id}`}
                  className="font-mono font-medium text-accent hover:underline"
                >
                  {openRepair.reference}
                </Link>
                . Its status and owner follow the job until the job is finished.
              </span>
            </p>
          )}
          {canReadRepairs && (
            <RepairsPanel
              asset={asset}
              onBookIn={
                canBookIn && asset.status === 'ACTIVE' && asset.customer
                  ? () => setBookingIn(true)
                  : undefined
              }
            />
          )}
          <Panel>
            <PanelHeader title="Lifecycle history" description="Newest first. Cannot be edited." />
            <HistoryTimeline assetId={asset.id} />
          </Panel>

          {canSeeAudit && (
            <Panel>
              <PanelHeader title="Activity" description="Audit entries for this asset." />
              <ActivityFeed
                filters={{ assetId: asset.id, page: activityPage, pageSize: 10 }}
                onPage={setActivityPage}
                showTarget={false}
              />
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Owner" />
            <div className="px-5 py-4 text-sm">
              {asset.customer ? (
                <>
                  {canSeeCustomers ? (
                    <Link
                      to={`/customers/${asset.customer.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {asset.customer.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{asset.customer.name}</span>
                  )}
                  <p className="font-mono text-[12px] text-ink-subtle">
                    {asset.customer.accountNumber}
                  </p>
                </>
              ) : (
                <p className="text-ink-muted">Company stock: not assigned to a customer.</p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Warranty" />
            <DetailList
              columns={1}
              items={[
                [
                  'Status',
                  <WarrantyBadge key="w" expiresOn={asset.warrantyExpiresOn} today={today} />,
                ],
                ['Expires', asset.warrantyExpiresOn && formatDate(asset.warrantyExpiresOn)],
                ['Details', asset.warrantyNotes],
              ]}
            />
          </Panel>
        </div>
      </div>

      <AssetFormDialog open={editing} onOpenChange={setEditing} asset={asset} />
      <AssetStatusDialog asset={asset} open={changingStatus} onOpenChange={setChangingStatus} />
      <NewRepairDialog open={bookingIn} onOpenChange={setBookingIn} asset={asset} />
    </>
  );
}

export function AssetDetailPage() {
  const { id = '' } = useParams();
  const asset = useAsset(id);

  return (
    <>
      <Link
        to="/assets"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Assets
      </Link>
      {asset.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : asset.isError ? (
        asset.error instanceof ApiError &&
        (asset.error.status === 404 || asset.error.status === 400) ? (
          <EmptyState
            icon={Laptop}
            title="Asset not found"
            description="It may have been mistyped. Search the asset register instead."
          />
        ) : (
          <ErrorState error={asset.error} onRetry={() => asset.refetch()} />
        )
      ) : (
        <AssetBody asset={asset.data} />
      )}
    </>
  );
}
