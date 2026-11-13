import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Laptop, Wrench } from 'lucide-react';
import {
  ASSET_CATEGORY_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_STATUS_DESCRIPTIONS,
  ASSET_STATUS_LABELS,
  type PortalAssetEvent,
} from '@deviceflow/shared';
import { DetailList, Panel, PanelHeader } from '../../design/Page';
import { EmptyState, ErrorState, Skeleton } from '../../design/States';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, todayIso } from '../../lib/format';
import { AssetStatusBadge, WarrantyBadge } from '../../lib/status';
import { Button } from '../../design/Button';
import { usePortalAsset, usePortalAssetHistory, usePortalRepairs } from './api';
import { RepairStatusBadge } from '../../lib/status';
import { RequestRepairDialog } from './PortalRepairsPage';

function describe(e: PortalAssetEvent): string {
  if (e.type === 'STATUS_CHANGED' && e.fromStatus && e.toStatus) {
    return `${ASSET_STATUS_LABELS[e.fromStatus]} → ${ASSET_STATUS_LABELS[e.toStatus]}`;
  }
  if (e.type === 'REGISTERED') return 'Registered to your account';
  return 'Assigned to your account';
}

function History({ id }: { id: string }) {
  const history = usePortalAssetHistory(id);
  if (history.isPending) return <Skeleton className="m-5 h-16" />;
  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => history.refetch()} />;
  if (history.data.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-muted">No history yet.</p>;
  }
  return (
    <ol className="divide-y divide-line">
      {history.data.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
          <span>{describe(e)}</span>
          <time className="shrink-0 text-[12px] text-ink-subtle" dateTime={e.createdAt}>
            {formatDateTime(e.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

function DeviceRepairs({ id }: { id: string }) {
  const repairs = usePortalRepairs({ state: '', asset: id, page: 1 });
  if (repairs.isPending) return <Skeleton className="m-5 h-10" />;
  if (repairs.isError)
    return <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />;
  if (repairs.data.data.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-muted">No repairs for this device.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {repairs.data.data.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
          <span>
            <Link to={`/portal/repairs/${r.id}`} className="font-mono font-medium hover:underline">
              {r.reference}
            </Link>
            <span className="ml-2 text-[12px] text-ink-subtle">{formatDateTime(r.createdAt)}</span>
          </span>
          <RepairStatusBadge status={r.status} portal />
        </li>
      ))}
    </ul>
  );
}

export function PortalDevicePage() {
  const { id = '' } = useParams();
  const asset = usePortalAsset(id);
  const [requesting, setRequesting] = useState(false);

  return (
    <>
      <Link
        to="/portal"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> My devices
      </Link>
      {asset.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : asset.isError ? (
        asset.error instanceof ApiError &&
        (asset.error.status === 404 || asset.error.status === 400) ? (
          <EmptyState
            icon={Laptop}
            title="Device not found"
            description="This device is not registered to your account."
          />
        ) : (
          <ErrorState error={asset.error} onRetry={() => asset.refetch()} />
        )
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">
                  {asset.data.manufacturer} {asset.data.model}
                </h1>
                <AssetStatusBadge status={asset.data.status} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                <span className="font-mono">{asset.data.assetTag}</span> ·{' '}
                {ASSET_STATUS_DESCRIPTIONS[asset.data.status]}
              </p>
            </div>
            {asset.data.status === 'ACTIVE' && (
              <Button variant="primary" onClick={() => setRequesting(true)}>
                <Wrench size={14} aria-hidden="true" /> Request a repair
              </Button>
            )}
          </header>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Details" />
              <DetailList
                items={[
                  ['Type', ASSET_CATEGORY_LABELS[asset.data.category]],
                  ['Condition', ASSET_CONDITION_LABELS[asset.data.condition]],
                  [
                    'Serial number',
                    asset.data.serialNumber && (
                      <span className="font-mono">{asset.data.serialNumber}</span>
                    ),
                  ],
                  ['Purchased', asset.data.purchaseDate && formatDate(asset.data.purchaseDate)],
                  [
                    'Warranty',
                    <WarrantyBadge
                      key="w"
                      expiresOn={asset.data.warrantyExpiresOn}
                      today={todayIso()}
                    />,
                  ],
                  [
                    'Warranty ends',
                    asset.data.warrantyExpiresOn && formatDate(asset.data.warrantyExpiresOn),
                  ],
                ]}
              />
            </Panel>
            <div className="space-y-5">
              <Panel>
                <PanelHeader title="Repairs" />
                <DeviceRepairs id={asset.data.id} />
              </Panel>
              <Panel>
                <PanelHeader title="History" />
                <History id={asset.data.id} />
              </Panel>
            </div>
          </div>
          <RequestRepairDialog open={requesting} onOpenChange={setRequesting} device={asset.data} />
        </>
      )}
    </>
  );
}
