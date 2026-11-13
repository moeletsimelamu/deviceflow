import { useState } from 'react';
import { Link } from 'react-router';
import { PackageMinus, Undo2 } from 'lucide-react';
import {
  MAX_MOVEMENT_QUANTITY,
  PART_USAGE_STATUSES,
  type Part,
  type PartRef,
  type Repair,
} from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { Panel, PanelHeader, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { TextAreaField, TextField } from '../../design/Field';
import { ErrorState, FormError, Skeleton } from '../../design/States';
import { cn } from '../../design/cn';
import { ApiError } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/hooks';
import { useCurrency } from '../../lib/settings';
import { useRepairParts, useReturnRepairPart, useUseRepairPart } from '../inventory/api';
import { MovementTable } from '../inventory/MovementTable';
import { parseUnits, PartPicker } from '../inventory/PartDialogs';

function quantityError(error: unknown): string | undefined {
  return error instanceof ApiError
    ? error.details.find((d) => d.path === 'quantity')?.message
    : undefined;
}

// --- Use a part ---------------------------------------------------------------------------

export function UsePartForm({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const use = useUseRepairPart(repair.id, useIdempotencyKey());
  const [part, setPart] = useState<Part | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ part?: string; quantity?: string }>({});
  const units = parseUnits(quantity);

  const submit = () => {
    const next = {
      part: part ? undefined : 'Choose a part',
      quantity:
        units === null
          ? `Enter 1 to ${MAX_MOVEMENT_QUANTITY}`
          : part && units > part.quantityOnHand
            ? `Only ${part.quantityOnHand} in stock`
            : undefined,
    };
    setErrors(next);
    if (next.part || next.quantity || !part || units === null) return;
    use.mutate(
      { partId: part.id, quantity: units, note: note.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={use.error} />
        <PartPicker
          value={part}
          onChange={(p) => {
            setPart(p);
            setErrors((e) => ({ ...e, part: undefined }));
          }}
          error={errors.part}
        />
        <TextField
          label="Units used"
          required
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={errors.quantity ?? quantityError(use.error)}
          hint={part ? `${part.quantityOnHand} in stock` : undefined}
        />
        <TextAreaField
          label="Note (optional)"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="Staff only. Shown in the stock ledger."
        />
        <p className="text-[13px] text-ink-muted">
          The units leave stock now. If you do not fit them, return them to stock from this job.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={use.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={use.isPending}>
          Use part
        </Button>
      </DialogFooter>
    </>
  );
}

// --- Return a part ---------------------------------------------------------------------------

function ReturnPartForm({
  repair,
  part,
  inUse,
  onClose,
}: {
  repair: Repair;
  part: PartRef;
  inUse: number;
  onClose: () => void;
}) {
  const giveBack = useReturnRepairPart(repair.id, useIdempotencyKey());
  const [quantity, setQuantity] = useState(String(inUse));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const units = parseUnits(quantity);

  const submit = () => {
    if (units === null || units > inUse) return setError(`Enter 1 to ${inUse}`);
    giveBack.mutate(
      { partId: part.id, quantity: units, note: note.trim() || null },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={giveBack.error} />
        <TextField
          label="Units to return"
          required
          inputMode="numeric"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setError(undefined);
          }}
          error={error ?? quantityError(giveBack.error)}
          hint={`${inUse} in use on this job`}
        />
        <TextAreaField
          label="Note (optional)"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="For example: not needed after all, wrong model."
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={giveBack.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={giveBack.isPending}>
          Return to stock
        </Button>
      </DialogFooter>
    </>
  );
}

// --- Panel -------------------------------------------------------------------------------------

export function RepairPartsPanel({ repair }: { repair: Repair }) {
  const currency = useCurrency();
  const canWork = useCan('repairs:work');
  const parts = useRepairParts(repair.id);
  const [using, setUsing] = useState(false);
  const [returning, setReturning] = useState<{ part: PartRef; inUse: number } | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const open = canWork && PART_USAGE_STATUSES.includes(repair.status);

  return (
    <Panel>
      <PanelHeader
        title="Parts"
        description={
          open || !canWork
            ? 'Parts taken from stock for this job.'
            : 'Parts can be used while the job is in repair, waiting for parts or in quality check.'
        }
        actions={
          open && (
            <Button size="sm" onClick={() => setUsing(true)}>
              <PackageMinus size={13} aria-hidden="true" /> Use part
            </Button>
          )
        }
      />
      {parts.isPending ? (
        <Skeleton className="m-5 h-10" />
      ) : parts.isError ? (
        <ErrorState error={parts.error} onRetry={() => parts.refetch()} />
      ) : parts.data.lines.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          {parts.data.movements.length > 0
            ? 'Every part used on this job has been returned to stock.'
            : 'No parts used yet.'}
        </p>
      ) : (
        <div className={table.wrap}>
          <table className={table.table}>
            <thead>
              <tr>
                <th className={table.th} scope="col">
                  Part
                </th>
                <th className={cn(table.th, 'text-right')} scope="col">
                  Units
                </th>
                <th className={cn(table.th, 'text-right')} scope="col">
                  Cost
                </th>
                {open && (
                  <th className={table.th} scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {parts.data.lines.map((line) => (
                <tr key={line.part.id}>
                  <td className={cn(table.td, 'h-auto py-2')}>
                    <Link
                      to={`/inventory/parts/${line.part.id}`}
                      className="font-medium text-ink hover:text-accent hover:underline"
                    >
                      {line.part.name}
                    </Link>
                    <span className="block font-mono text-[12px] text-ink-subtle">
                      {line.part.sku}
                    </span>
                  </td>
                  <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums')}>
                    {line.quantity}
                  </td>
                  <td
                    className={cn(
                      table.td,
                      'h-auto py-2 text-right tabular-nums whitespace-nowrap',
                    )}
                  >
                    {formatMoney(line.costCents, currency)}
                  </td>
                  {open && (
                    <td className={cn(table.td, 'h-auto w-0 py-2 text-right')}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReturning({ part: line.part, inUse: line.quantity })}
                        aria-label={`Return ${line.part.name} to stock`}
                      >
                        <Undo2 size={13} aria-hidden="true" />
                        <span className="max-sm:sr-only">Return</span>
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex justify-between gap-6 px-4 py-3 text-sm font-medium">
            <span>Parts cost (at stock cost, excl. VAT)</span>
            <span className="tabular-nums">{formatMoney(parts.data.totalCostCents, currency)}</span>
          </p>
        </div>
      )}
      {parts.data && parts.data.movements.length > 0 && (
        <div className="border-t border-line">
          <button
            type="button"
            className="px-5 py-2.5 text-[13px] font-medium text-accent hover:underline"
            aria-expanded={showLedger}
            onClick={() => setShowLedger((s) => !s)}
          >
            {showLedger ? 'Hide' : 'Show'} every use and return ({parts.data.movements.length})
          </button>
          {showLedger && (
            <MovementTable movements={parts.data.movements} currency={currency} linkJobs={false} />
          )}
        </div>
      )}

      <Dialog
        open={using}
        onOpenChange={setUsing}
        title={`Use a part on ${repair.reference}`}
        description="Takes the units out of stock for this job."
        width="max-w-lg"
      >
        {using && <UsePartForm repair={repair} onClose={() => setUsing(false)} />}
      </Dialog>
      <Dialog
        open={returning !== null}
        onOpenChange={(o) => !o && setReturning(null)}
        title={returning ? `Return ${returning.part.name}` : ''}
        description="Puts unused units back in stock."
      >
        {returning && (
          <ReturnPartForm
            repair={repair}
            part={returning.part}
            inUse={returning.inUse}
            onClose={() => setReturning(null)}
          />
        )}
      </Dialog>
    </Panel>
  );
}
