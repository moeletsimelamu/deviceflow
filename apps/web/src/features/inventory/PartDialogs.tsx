import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  MAX_MOVEMENT_QUANTITY,
  normaliseSku,
  PART_CATEGORIES,
  PART_CATEGORY_LABELS,
  type AdjustmentDirection,
  type Paginated,
  type Part,
  type PartCategory,
} from '@deviceflow/shared';
import { Combobox } from '../../design/Combobox';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { SelectField, TextAreaField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { FormError } from '../../design/States';
import { cn } from '../../design/cn';
import { api, ApiError, toQueryString } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useDebounced, useIdempotencyKey } from '../../lib/hooks';
import { useCurrency } from '../../lib/settings';
import { StockStateBadge } from '../../lib/status';
import { parseRandToCents } from '../repairs/RepairDialogs';
import { useCreatePart, useRecordAdjustment, useRecordPurchase, useUpdatePart } from './api';

function fieldError(error: unknown, path: string): string | undefined {
  return error instanceof ApiError
    ? error.details.find((d) => d.path === path)?.message
    : undefined;
}

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Whole units from 1 to the per-movement limit; null otherwise. */
export function parseUnits(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,5}$/.test(clean)) return null;
  const value = Number(clean);
  return value >= 1 && value <= MAX_MOVEMENT_QUANTITY ? value : null;
}

// --- Add or edit a part -------------------------------------------------------------

function PartForm({ part, onClose }: { part: Part | null; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreatePart(useIdempotencyKey());
  const update = useUpdatePart(part?.id ?? '');
  const mutation = part ? update : create;
  const [sku, setSku] = useState(part?.sku ?? '');
  const [name, setName] = useState(part?.name ?? '');
  const [category, setCategory] = useState<PartCategory>(part?.category ?? 'OTHER');
  const [location, setLocation] = useState(part?.location ?? '');
  const [reorderLevel, setReorderLevel] = useState(String(part?.reorderLevel ?? 0));
  const [description, setDescription] = useState(part?.description ?? '');
  const [errors, setErrors] = useState<Partial<Record<'sku' | 'name' | 'reorderLevel', string>>>(
    {},
  );

  const submit = () => {
    const level = /^\d{1,6}$/.test(reorderLevel.trim()) ? Number(reorderLevel) : null;
    const next = {
      sku: !sku.trim()
        ? 'Enter a SKU'
        : SKU_PATTERN.test(sku.trim())
          ? undefined
          : 'Use letters, digits, dots, dashes or slashes',
      name: name.trim() ? undefined : 'Enter a name',
      reorderLevel: level === null ? 'Enter a whole number, 0 or more' : undefined,
    };
    setErrors(next);
    if (next.sku || next.name || next.reorderLevel || level === null) return;
    const body = {
      sku: normaliseSku(sku),
      name: name.trim(),
      category,
      location: location.trim() || null,
      reorderLevel: level,
      description: description.trim() || null,
    };
    if (part) {
      update.mutate({ ...body, version: part.version }, { onSuccess: onClose });
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          onClose();
          void navigate(`/inventory/parts/${created.id}`);
        },
      });
    }
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={mutation.error} />
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <TextField
            label="SKU"
            required
            maxLength={40}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onBlur={() => setSku((s) => normaliseSku(s))}
            error={errors.sku ?? fieldError(mutation.error, 'sku')}
            className="font-mono"
          />
          <TextField
            label="Name"
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name ?? fieldError(mutation.error, 'name')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as PartCategory)}
            options={PART_CATEGORIES.map((c) => ({ value: c, label: PART_CATEGORY_LABELS[c] }))}
          />
          <TextField
            label="Location"
            maxLength={40}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            hint="Shelf or bin"
          />
          <TextField
            label="Reorder level"
            required
            inputMode="numeric"
            value={reorderLevel}
            onChange={(e) => setReorderLevel(e.target.value)}
            error={errors.reorderLevel ?? fieldError(mutation.error, 'reorderLevel')}
            hint="Flagged as low stock at or below this"
          />
        </div>
        <TextAreaField
          label="Description (optional)"
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          hint="Compatible models, supplier part number…"
        />
        {!part && (
          <p className="text-[13px] text-ink-muted">
            New parts start with no stock. Receive a delivery to add units.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={mutation.isPending}>
          {part ? 'Save changes' : 'Add part'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function PartFormDialog({
  part,
  open,
  onOpenChange,
}: {
  part: Part | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={part ? `Edit ${part.sku}` : 'Add a part'}
      width="max-w-xl"
    >
      {open && <PartForm part={part} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Receive a delivery ------------------------------------------------------------------

export function ReceiveForm({ part, onClose }: { part: Part; onClose: () => void }) {
  const currency = useCurrency();
  const receive = useRecordPurchase(part.id, useIdempotencyKey());
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const units = parseUnits(quantity);
  const cents = parseRandToCents(unitCost);

  const submit = () => {
    setShowErrors(true);
    if (units === null || cents === null) return;
    receive.mutate(
      {
        quantity: units,
        unitCostCents: cents,
        supplier: supplier.trim() || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={receive.error} />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Units received"
            required
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={showErrors && units === null ? `1 to ${MAX_MOVEMENT_QUANTITY}` : undefined}
          />
          <TextField
            label="Cost per unit (R, excl. VAT)"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            error={showErrors && cents === null ? 'Enter an amount, e.g. 780,00' : undefined}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Supplier (optional)"
            maxLength={160}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
          <TextField
            label="Invoice or order number (optional)"
            maxLength={80}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <TextAreaField
          label="Note (optional)"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {units !== null && cents !== null && (
          <p className="text-[13px] text-ink-muted" aria-live="polite">
            Stock goes from {part.quantityOnHand} to{' '}
            <strong className="text-ink">{part.quantityOnHand + units}</strong>. Delivery value{' '}
            {formatMoney(units * cents, currency)}. The average cost is recalculated.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={receive.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={receive.isPending}>
          Receive stock
        </Button>
      </DialogFooter>
    </>
  );
}

export function ReceiveStockDialog({
  part,
  open,
  onOpenChange,
}: {
  part: Part;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Receive ${part.name}`}
      description={`${part.sku} · ${part.quantityOnHand} in stock`}
      width="max-w-lg"
    >
      {open && <ReceiveForm part={part} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Adjust stock ------------------------------------------------------------------------------

export function AdjustForm({ part, onClose }: { part: Part; onClose: () => void }) {
  const adjust = useRecordAdjustment(part.id, useIdempotencyKey());
  const [direction, setDirection] = useState<AdjustmentDirection>('OUT');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ quantity?: string; note?: string }>({});
  const units = parseUnits(quantity);
  const out = direction === 'OUT';
  const after = units === null ? null : part.quantityOnHand + (out ? -units : units);

  const submit = () => {
    const next = {
      quantity:
        units === null
          ? `Enter 1 to ${MAX_MOVEMENT_QUANTITY}`
          : out && units > part.quantityOnHand
            ? `Only ${part.quantityOnHand} in stock`
            : undefined,
      note: note.trim() ? undefined : 'Give a reason for the adjustment',
    };
    setErrors(next);
    if (next.quantity || next.note || units === null) return;
    adjust.mutate({ direction, quantity: units, note: note.trim() }, { onSuccess: onClose });
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={adjust.error} />
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Change</legend>
          <div className="flex rounded-md border border-line-strong p-0.5" role="group">
            {(
              [
                ['OUT', 'Remove stock'],
                ['IN', 'Add stock'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                onClick={() => setDirection(value)}
                className={cn(
                  'flex-1 rounded-[5px] px-3 py-1.5 text-[13px] font-medium',
                  direction === value
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-sunken',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <TextField
          label="Units"
          required
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={errors.quantity}
        />
        <TextAreaField
          label="Reason"
          required
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note ?? fieldError(adjust.error, 'note')}
          hint={
            out
              ? 'For example: damaged in storage, failed on arrival, stock count was lower.'
              : 'For example: stock count was higher, found in the van.'
          }
        />
        {after !== null && after >= 0 && (
          <p className="text-[13px] text-ink-muted" aria-live="polite">
            Stock goes from {part.quantityOnHand} to <strong className="text-ink">{after}</strong>.
            Adjustments are permanent entries in the stock ledger; a mistake is corrected with
            another adjustment.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={adjust.isPending}>
          Cancel
        </Button>
        <Button variant={out ? 'danger' : 'primary'} onClick={submit} loading={adjust.isPending}>
          {out ? 'Remove from stock' : 'Add to stock'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AdjustStockDialog({
  part,
  open,
  onOpenChange,
}: {
  part: Part;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Adjust stock of ${part.name}`}
      description={`${part.sku} · ${part.quantityOnHand} in stock`}
    >
      {open && <AdjustForm part={part} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Part picker ------------------------------------------------------------------------------------

/** Searches active parts by SKU, name or location, showing how many are in stock. */
export function PartPicker({
  value,
  onChange,
  error,
}: {
  value: Part | null;
  onChange: (part: Part | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebounced(query.trim(), 200);
  const lookup = useQuery({
    queryKey: ['inventory', 'picker', search],
    queryFn: ({ signal }) =>
      api<Paginated<Part>>(`/inventory/parts${toQueryString({ search, pageSize: 10 })}`, {
        signal,
      }).then((r) => r.data),
    enabled: open,
  });
  return (
    <Combobox
      label="Part"
      required
      value={value}
      onChange={onChange}
      query={query}
      onQueryChange={setQuery}
      onOpenChange={setOpen}
      options={lookup.data ?? []}
      loading={lookup.isPending}
      placeholder="SKU, name or shelf"
      emptyText="No active parts match."
      listLabel="Parts"
      error={error}
      renderValue={(p) => (
        <span className="block truncate">
          <span className="font-mono text-[13px]">{p.sku}</span> {p.name}
          <span className="text-ink-subtle"> · {p.quantityOnHand} in stock</span>
        </span>
      )}
      renderOption={(p) => (
        <span className="block">
          <span className="flex justify-between gap-3">
            <span className="truncate">{p.name}</span>
            <StockStateBadge state={p.stockState} />
          </span>
          <span className="block truncate text-[12px] text-ink-subtle">
            <span className="font-mono">{p.sku}</span> · {p.quantityOnHand} in stock
            {p.location ? ` · ${p.location}` : ''}
          </span>
        </span>
      )}
    />
  );
}
