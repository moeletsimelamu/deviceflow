import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BellRing, Plus, Wrench } from 'lucide-react';
import type { PortalAsset } from '@deviceflow/shared';
import { PageHeader, Panel, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { SelectField, TextAreaField } from '../../design/Field';
import { EmptyState, ErrorState, FormError, TableSkeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { cn } from '../../design/cn';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/hooks';
import { RepairStatusBadge } from '../../lib/status';
import { usePortalAssets, usePortalRepairs, useRequestRepair } from './api';

function RequestForm({ device, onClose }: { device?: PortalAsset; onClose: () => void }) {
  const navigate = useNavigate();
  const request = useRequestRepair(useIdempotencyKey());
  // Only devices in use can be booked in; a device already in repair is not ACTIVE.
  const devices = usePortalAssets({ search: '', status: 'ACTIVE', page: 1 });
  const [assetId, setAssetId] = useState(device?.id ?? '');
  const [fault, setFault] = useState('');
  const [errors, setErrors] = useState<{ asset?: string; fault?: string }>({});
  const options = devices.data?.data ?? [];

  const submit = () => {
    const next = {
      asset: assetId ? undefined : 'Choose the device',
      fault: fault.trim().length < 5 ? 'Describe the problem in a few words' : undefined,
    };
    setErrors(next);
    if (next.asset || next.fault) return;
    request.mutate(
      { assetId, faultDescription: fault.trim() },
      {
        onSuccess: (repair) => {
          onClose();
          void navigate(`/portal/repairs/${repair.id}`);
        },
      },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={request.error} />
        {device ? (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
            {device.manufacturer} {device.model}{' '}
            <span className="font-mono text-[12px] text-ink-subtle">{device.assetTag}</span>
          </p>
        ) : (
          <SelectField
            label="Device"
            required
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            disabled={devices.isPending}
            error={errors.asset}
            hint={
              !devices.isPending && options.length === 0
                ? 'None of your devices can be booked in right now. Devices already being repaired are not listed.'
                : 'Devices already being repaired are not listed.'
            }
            options={[
              { value: '', label: devices.isPending ? 'Loading…' : 'Choose a device' },
              ...options.map((a) => ({
                value: a.id,
                label: `${a.manufacturer} ${a.model} (${a.assetTag})`,
              })),
            ]}
          />
        )}
        <TextAreaField
          label="What is wrong?"
          required
          rows={4}
          maxLength={2000}
          value={fault}
          onChange={(e) => setFault(e.target.value)}
          error={
            errors.fault ??
            (request.error instanceof ApiError
              ? request.error.details.find((d) => d.path === 'faultDescription')?.message
              : undefined)
          }
          hint="For example what happens, since when, and anything you have tried."
        />
        <p className="text-[13px] text-ink-muted">
          We will look at the device and send you a quotation to approve before any paid work
          starts.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={request.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={request.isPending}>
          Send request
        </Button>
      </DialogFooter>
    </>
  );
}

export function RequestRepairDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device?: PortalAsset;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a repair" width="max-w-lg">
      {open && <RequestForm device={device} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Finished' },
  { value: '', label: 'All' },
] as const;

export function PortalRepairsPage() {
  const [state, setState] = useState<'open' | 'closed' | ''>('open');
  const [page, setPage] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const repairs = usePortalRepairs({ state, page });
  const waiting = usePortalRepairs({ state: 'open', page: 1 }).data?.data.filter(
    (r) => r.status === 'AWAITING_APPROVAL',
  );

  return (
    <>
      <PageHeader
        title="My repairs"
        description="Repairs for your devices, and quotations waiting for your approval."
        actions={
          <Button variant="primary" onClick={() => setRequesting(true)}>
            <Plus size={14} aria-hidden="true" /> Request a repair
          </Button>
        }
      />
      {waiting && waiting.length > 0 && (
        <div
          className="mb-5 flex gap-2 rounded-md border border-warning-fg/25 bg-warning-bg px-4 py-3 text-sm text-warning-fg"
          role="status"
        >
          <BellRing size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {waiting.length === 1 ? 'A quotation is' : `${waiting.length} quotations are`} waiting
            for your approval:{' '}
            {waiting.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <Link to={`/portal/repairs/${r.id}`} className="font-medium underline">
                  {r.reference}
                </Link>
              </span>
            ))}
          </span>
        </div>
      )}
      <Panel>
        <div className="flex border-b border-line px-4 py-3">
          <div
            className="flex rounded-md border border-line-strong p-0.5"
            role="group"
            aria-label="Show"
          >
            {STATES.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-pressed={state === s.value}
                onClick={() => {
                  setState(s.value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[13px] font-medium',
                  state === s.value
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-sunken',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {repairs.isPending ? (
          <TableSkeleton columns={4} />
        ) : repairs.isError ? (
          <ErrorState error={repairs.error} onRetry={() => repairs.refetch()} />
        ) : repairs.data.data.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title={state === 'open' ? 'No open repairs' : 'No repairs yet'}
            description="When a device needs attention, request a repair and track it here."
          />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th className={table.th} scope="col">
                    Device
                  </th>
                  <th className={cn(table.th, 'max-sm:hidden')} scope="col">
                    Status
                  </th>
                  <th className={cn(table.th, 'max-sm:hidden')} scope="col">
                    Requested
                  </th>
                </tr>
              </thead>
              <tbody className={repairs.isPlaceholderData ? 'opacity-60' : undefined}>
                {repairs.data.data.map((r) => (
                  <tr key={r.id} className={table.row}>
                    <td className={cn(table.td, 'py-2')}>
                      <Link
                        to={`/portal/repairs/${r.id}`}
                        className="font-medium text-ink hover:text-accent hover:underline"
                      >
                        {r.device.manufacturer} {r.device.model}
                      </Link>
                      <div className="text-[13px] text-ink-muted">
                        <span className="font-mono whitespace-nowrap">{r.reference}</span> ·{' '}
                        <span className="font-mono whitespace-nowrap">{r.device.assetTag}</span>
                      </div>
                      <div className="mt-1 sm:hidden">
                        <RepairStatusBadge status={r.status} portal />
                      </div>
                    </td>
                    <td className={cn(table.td, 'max-sm:hidden')}>
                      <RepairStatusBadge status={r.status} portal />
                    </td>
                    <td
                      className={cn(
                        table.td,
                        'text-[13px] whitespace-nowrap text-ink-muted max-sm:hidden',
                      )}
                    >
                      {formatDateTime(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={repairs.data?.meta} onPage={setPage} />
      </Panel>
      <RequestRepairDialog open={requesting} onOpenChange={setRequesting} />
    </>
  );
}
