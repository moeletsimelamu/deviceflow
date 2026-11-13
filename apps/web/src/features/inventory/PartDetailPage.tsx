import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Boxes,
  PackagePlus,
  Pencil,
  Scale,
} from 'lucide-react';
import { PART_CATEGORY_LABELS, type Part } from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { DetailList, Panel, PanelHeader } from '../../design/Page';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { ConfirmDialog } from '../../design/Dialog';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useCurrency } from '../../lib/settings';
import { StockStateBadge } from '../../lib/status';
import { ActivityFeed } from '../activity/ActivityFeed';
import { useMovements, usePart, useUpdatePart } from './api';
import { MovementTable } from './MovementTable';
import { AdjustStockDialog, PartFormDialog, ReceiveStockDialog } from './PartDialogs';

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[12px] font-medium text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function Ledger({ part }: { part: Part }) {
  const currency = useCurrency();
  const canOpenJobs = useCan('repairs:read');
  const [page, setPage] = useState(1);
  const movements = useMovements({ type: '', part: part.id, from: '', to: '', page }, 15);
  return (
    <Panel>
      <PanelHeader
        title="Stock ledger"
        description="Every change to this part's stock, newest first. Entries cannot be edited."
      />
      {movements.isPending ? (
        <TableSkeleton columns={6} rows={4} />
      ) : movements.isError ? (
        <ErrorState error={movements.error} onRetry={() => movements.refetch()} />
      ) : movements.data.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No stock has been received or used yet.</p>
      ) : (
        <MovementTable
          movements={movements.data.data}
          currency={currency}
          showPart={false}
          showBalance
          linkJobs={canOpenJobs}
          dimmed={movements.isPlaceholderData}
        />
      )}
      <Pagination meta={movements.data?.meta} onPage={setPage} />
    </Panel>
  );
}

function PartBody({ part }: { part: Part }) {
  const currency = useCurrency();
  const canManage = useCan('inventory:manage');
  const canSeeAudit = useCan('audit:read');
  const archive = useUpdatePart(part.id);
  const [dialog, setDialog] = useState<'edit' | 'receive' | 'adjust' | 'archive' | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{part.name}</h1>
            {part.isActive ? (
              <StockStateBadge state={part.stockState} />
            ) : (
              <Badge tone="neutral">Archived</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-mono">{part.sku}</span> · {PART_CATEGORY_LABELS[part.category]}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {part.isActive ? (
              <>
                <Button variant="ghost" onClick={() => setDialog('archive')}>
                  <Archive size={14} aria-hidden="true" /> Archive
                </Button>
                <Button onClick={() => setDialog('edit')}>
                  <Pencil size={14} aria-hidden="true" /> Edit
                </Button>
                <Button onClick={() => setDialog('adjust')}>
                  <Scale size={14} aria-hidden="true" /> Adjust stock
                </Button>
                <Button variant="primary" onClick={() => setDialog('receive')}>
                  <PackagePlus size={14} aria-hidden="true" /> Receive stock
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                loading={archive.isPending}
                onClick={() => archive.mutate({ isActive: true, version: part.version })}
              >
                <ArchiveRestore size={14} aria-hidden="true" /> Restore
              </Button>
            )}
          </div>
        )}
      </header>

      {!part.isActive && (
        <p className="mb-5 rounded-md border border-line bg-canvas px-4 py-3 text-sm text-ink-muted">
          This part is archived. It is hidden from pickers and cannot be received or used. Its
          history is kept.
        </p>
      )}

      <div className="space-y-5">
        <Panel>
          <div className="grid divide-line max-sm:divide-y sm:grid-cols-3 sm:divide-x">
            <Figure
              label="In stock"
              value={String(part.quantityOnHand)}
              hint={`Reorder at ${part.reorderLevel} or fewer`}
            />
            <Figure
              label="Average cost"
              value={formatMoney(part.averageCostCents, currency)}
              hint="Per unit, weighted by deliveries"
            />
            <Figure
              label="Stock value"
              value={formatMoney(part.stockValueCents, currency)}
              hint="In stock × average cost"
            />
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-5">
            <Ledger part={part} />
            {canSeeAudit && (
              <Panel>
                <PanelHeader title="Activity" description="Audit entries for this part." />
                <ActivityFeed
                  filters={{
                    entityType: 'Part',
                    entityId: part.id,
                    page: activityPage,
                    pageSize: 10,
                  }}
                  onPage={setActivityPage}
                  showTarget={false}
                />
              </Panel>
            )}
          </div>
          <Panel className="self-start">
            <PanelHeader title="Details" />
            <DetailList
              columns={1}
              items={[
                ['Location', part.location && <span className="font-mono">{part.location}</span>],
                ['Category', PART_CATEGORY_LABELS[part.category]],
                ['Description', part.description],
                ['Added', formatDateTime(part.createdAt)],
                ['Last changed', formatDateTime(part.updatedAt)],
              ]}
            />
          </Panel>
        </div>
      </div>

      <PartFormDialog part={part} open={dialog === 'edit'} onOpenChange={close} />
      <ReceiveStockDialog part={part} open={dialog === 'receive'} onOpenChange={close} />
      <AdjustStockDialog part={part} open={dialog === 'adjust'} onOpenChange={close} />
      <ConfirmDialog
        open={dialog === 'archive'}
        onOpenChange={(open) => {
          close(open);
          if (!open) archive.reset();
        }}
        title={`Archive ${part.name}?`}
        body={
          part.quantityOnHand > 0 ? (
            <p>
              It still has <strong className="text-ink">{part.quantityOnHand}</strong> in stock. Use
              the stock on repairs or write it off with an adjustment first.
            </p>
          ) : (
            <p>
              The part is hidden from pickers and can no longer be received or used. Its stock
              ledger is kept, and you can restore it later.
            </p>
          )
        }
        confirmLabel="Archive part"
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() =>
          archive.mutate(
            { isActive: false, version: part.version },
            { onSuccess: () => setDialog(null) },
          )
        }
      />
    </>
  );
}

export function PartDetailPage() {
  const { id = '' } = useParams();
  const part = usePart(id);
  return (
    <>
      <Link
        to="/inventory"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Inventory
      </Link>
      {part.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : part.isError ? (
        part.error instanceof ApiError &&
        (part.error.status === 404 || part.error.status === 400) ? (
          <EmptyState icon={Boxes} title="Part not found" description="It may not exist." />
        ) : (
          <ErrorState error={part.error} onRetry={() => part.refetch()} />
        )
      ) : (
        <PartBody part={part.data} />
      )}
    </>
  );
}
