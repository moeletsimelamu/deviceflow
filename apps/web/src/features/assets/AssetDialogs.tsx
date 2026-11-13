import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_STATUS_DESCRIPTIONS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES_REQUIRING_REASON,
  ASSET_STATUSES_SET_BY_REPAIRS,
  ASSET_TRANSITIONS,
  createAssetSchema,
  type Asset,
  type AssetStatus,
  type CustomerSummary,
  type UpdateAssetInput,
} from '@deviceflow/shared';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { SelectField, TextAreaField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { FormError } from '../../design/States';
import { cn } from '../../design/cn';
import { ApiError } from '../../lib/api';
import { todayIso } from '../../lib/format';
import { AssetStatusBadge } from '../../lib/status';
import { CustomerPicker } from '../customers/CustomerPicker';
import { useChangeAssetStatus, useCreateAsset, useUpdateAsset } from './api';

type FormIn = z.input<typeof createAssetSchema>;
type FormOut = z.output<typeof createAssetSchema>;

const empty: FormIn = {
  category: 'LAPTOP',
  manufacturer: '',
  model: '',
  serialNumber: '',
  condition: 'GOOD',
  status: 'IN_STOCK',
  customerAccountId: null,
  purchaseDate: '',
  warrantyExpiresOn: '',
  warrantyNotes: '',
  notes: '',
};

function fromAsset(a: Asset): FormIn {
  return {
    category: a.category,
    manufacturer: a.manufacturer,
    model: a.model,
    serialNumber: a.serialNumber ?? '',
    condition: a.condition,
    // Only used for the "an active asset needs a customer" check while editing.
    status: a.status === 'ACTIVE' ? 'ACTIVE' : 'IN_STOCK',
    customerAccountId: a.customer?.id ?? null,
    purchaseDate: a.purchaseDate ?? '',
    warrantyExpiresOn: a.warrantyExpiresOn ?? '',
    warrantyNotes: a.warrantyNotes ?? '',
    notes: a.notes ?? '',
  };
}

const DIFF_KEYS = [
  'category',
  'manufacturer',
  'model',
  'serialNumber',
  'condition',
  'purchaseDate',
  'warrantyExpiresOn',
  'warrantyNotes',
  'notes',
] as const;

/** Only the fields that differ from the stored asset go into the PATCH. */
function diff(asset: Asset, values: FormOut): UpdateAssetInput {
  const input: Record<string, unknown> = { version: asset.version };
  for (const key of DIFF_KEYS) {
    if ((values[key] ?? null) !== (asset[key] ?? null)) input[key] = values[key] ?? null;
  }
  if ((values.customerAccountId ?? null) !== (asset.customer?.id ?? null)) {
    input.customerAccountId = values.customerAccountId ?? null;
  }
  return input as UpdateAssetInput;
}

/** Registers an asset (then opens it), or edits details and assignment of `asset`. */
export function AssetFormDialog({
  open,
  onOpenChange,
  asset,
  initialCustomer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  asset?: Asset;
  /** Pre-selects a customer (registering from a customer's page). */
  initialCustomer?: CustomerSummary;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={asset ? `Edit ${asset.assetTag}` : 'Register asset'}
      description={
        asset
          ? `${asset.manufacturer} ${asset.model}`
          : 'The asset tag is generated when you save and never reused.'
      }
      width="max-w-xl"
    >
      {/* The dialog body unmounts when closed, so every opening starts from fresh state. */}
      <AssetForm
        asset={asset}
        initialCustomer={initialCustomer}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

function AssetForm({
  asset,
  initialCustomer,
  onClose,
}: {
  asset?: Asset;
  initialCustomer?: CustomerSummary;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const create = useCreateAsset();
  const update = useUpdateAsset(asset?.id ?? '');
  const mutation = asset ? update : create;
  const startCustomer = asset?.customer ?? initialCustomer ?? null;
  const [customer, setCustomer] = useState<CustomerSummary | null>(startCustomer);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: asset
      ? fromAsset(asset)
      : {
          ...empty,
          customerAccountId: startCustomer?.id ?? null,
          status: startCustomer ? 'ACTIVE' : 'IN_STOCK',
        },
  });
  const status = useWatch({ control: form.control, name: 'status' });

  const onSubmit = form.handleSubmit((values) => {
    const onError = (err: unknown) => {
      if (err instanceof ApiError) {
        for (const d of err.details) {
          form.setError(d.path as keyof FormIn, { message: d.message });
        }
      }
    };
    if (asset) {
      const input = diff(asset, values);
      if (Object.keys(input).length === 1) return onClose();
      update.mutate(input, { onSuccess: onClose, onError });
    } else {
      create.mutate(values, {
        onSuccess: (created) => {
          onClose();
          void navigate(`/assets/${created.id}`);
        },
        onError,
      });
    }
  });

  const errors = form.formState.errors;
  const bannerError =
    mutation.error instanceof ApiError && mutation.error.details.length > 0 ? null : mutation.error;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError error={bannerError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Category"
          required
          options={ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] }))}
          {...form.register('category')}
        />
        <SelectField
          label="Condition"
          required
          options={ASSET_CONDITIONS.map((c) => ({ value: c, label: ASSET_CONDITION_LABELS[c] }))}
          {...form.register('condition')}
        />
        <TextField
          label="Manufacturer"
          required
          autoComplete="off"
          placeholder="Dell, HP, Apple…"
          error={errors.manufacturer?.message}
          {...form.register('manufacturer')}
        />
        <TextField
          label="Model"
          required
          autoComplete="off"
          error={errors.model?.message}
          {...form.register('model')}
        />
      </div>
      <TextField
        label="Serial number"
        autoComplete="off"
        className="font-mono"
        hint="Stored in capitals without spaces. Each serial can be registered once per manufacturer."
        error={errors.serialNumber?.message}
        {...form.register('serialNumber')}
      />

      <Controller
        control={form.control}
        name="customerAccountId"
        render={({ field }) => (
          <CustomerPicker
            label="Customer"
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              field.onChange(c?.id ?? null);
              if (!asset) form.setValue('status', c ? 'ACTIVE' : 'IN_STOCK');
            }}
            error={errors.customerAccountId?.message}
            hint={
              asset
                ? 'Reassigning is recorded in the asset history.'
                : 'Leave empty for devices your company holds in stock.'
            }
          />
        )}
      />
      {!asset && customer && (
        <SelectField
          label="Starting status"
          options={[
            { value: 'ACTIVE', label: 'Active: in use by the customer' },
            { value: 'IN_STOCK', label: 'In stock: held by us for the customer' },
          ]}
          {...form.register('status')}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Purchase date"
          type="date"
          max={todayIso()}
          error={errors.purchaseDate?.message}
          {...form.register('purchaseDate')}
        />
        <TextField
          label="Warranty expires"
          type="date"
          error={errors.warrantyExpiresOn?.message}
          {...form.register('warrantyExpiresOn')}
        />
      </div>
      <TextField
        label="Warranty details"
        autoComplete="off"
        placeholder="Provider, plan or reference"
        error={errors.warrantyNotes?.message}
        {...form.register('warrantyNotes')}
      />
      <TextAreaField
        label="Internal notes"
        hint="Visible to staff only."
        error={errors.notes?.message}
        {...form.register('notes')}
      />
      {asset && status === 'ACTIVE' && (
        <p className="text-[13px] text-ink-subtle">
          This asset is active, so it must stay assigned to a customer.
        </p>
      )}
      <DialogFooter>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {asset ? 'Save changes' : 'Register asset'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Lists only the transitions the lifecycle allows from the current status. */
export function AssetStatusDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change status of ${asset.assetTag}`}
      description={
        <>
          Currently <AssetStatusBadge status={asset.status} />
        </>
      }
    >
      <StatusForm asset={asset} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function StatusForm({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const change = useChangeAssetStatus(asset.id);
  // IN_REPAIR is set by repair jobs, never by hand (Phase 4).
  const targets = ASSET_TRANSITIONS[asset.status].filter(
    (s) => !ASSET_STATUSES_SET_BY_REPAIRS.includes(s),
  );
  const repairable = ASSET_TRANSITIONS[asset.status].includes('IN_REPAIR');
  const [target, setTarget] = useState<AssetStatus | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const needsReason = target !== null && ASSET_STATUSES_REQUIRING_REASON.includes(target);
  const blockedActive = target === 'ACTIVE' && !asset.customer;

  const submit = () => {
    if (!target) return;
    if (needsReason && reason.trim() === '') {
      setReasonError('Give a reason for this change');
      return;
    }
    change.mutate(
      { status: target, reason: reason.trim() || null, version: asset.version },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      {targets.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {ASSET_STATUS_LABELS[asset.status]} is a final status. No further changes are possible.
        </p>
      ) : (
        <div className="space-y-4">
          <FormError error={change.error} />
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">New status</legend>
            <div className="space-y-2">
              {targets.map((s) => (
                <label
                  key={s}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5',
                    target === s ? 'border-accent bg-accent-soft' : 'border-line hover:bg-canvas',
                  )}
                >
                  <input
                    type="radio"
                    name="asset-status"
                    value={s}
                    checked={target === s}
                    onChange={() => setTarget(s)}
                    className="mt-1 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium">{ASSET_STATUS_LABELS[s]}</span>
                    <span className="block text-[13px] text-ink-muted">
                      {ASSET_STATUS_DESCRIPTIONS[s]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {repairable && (
            <p className="text-[13px] text-ink-muted">
              To send this device for repair, book it in from its Repairs panel instead.
            </p>
          )}
          {blockedActive && (
            <p className="text-[13px] text-warning-fg" role="alert">
              Assign this asset to a customer before making it active.
            </p>
          )}
          <TextAreaField
            label={needsReason ? 'Reason' : 'Note (optional)'}
            required={needsReason}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(undefined);
            }}
            maxLength={500}
            error={reasonError}
            hint={target === 'DISPOSED' ? 'Disposal is final and cannot be undone.' : 'Staff only.'}
          />
        </div>
      )}
      <DialogFooter>
        <Button onClick={onClose} disabled={change.isPending}>
          {targets.length === 0 ? 'Close' : 'Cancel'}
        </Button>
        {targets.length > 0 && (
          <Button
            variant={target === 'DISPOSED' ? 'danger' : 'primary'}
            onClick={submit}
            disabled={!target || blockedActive}
            loading={change.isPending}
          >
            {target ? `Mark as ${ASSET_STATUS_LABELS[target].toLowerCase()}` : 'Change status'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
