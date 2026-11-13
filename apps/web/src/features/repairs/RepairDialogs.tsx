import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  DECISION_CHANNEL_LABELS,
  MAX_QUOTE_LINES,
  ON_BEHALF_CHANNELS,
  QUOTE_LINE_KIND_LABELS,
  QUOTE_LINE_KINDS,
  REPAIR_STATUS_LABELS,
  lineTotalCents,
  quoteTotals,
  toHundredths,
  type Asset,
  type Paginated,
  type Quotation,
  type QuoteLineKind,
  type Repair,
  type RepairTransitionRule,
} from '@deviceflow/shared';
import { Combobox } from '../../design/Combobox';
import { Dialog, DialogFooter } from '../../design/Dialog';
import { SelectField, TextAreaField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { FormError } from '../../design/States';
import { api, ApiError, toQueryString } from '../../lib/api';
import { formatMoney, todayIso } from '../../lib/format';
import { useDebounced, useIdempotencyKey } from '../../lib/hooks';
import { useCompanySettings } from '../../lib/settings';
import {
  useAddLabour,
  useAssignRepair,
  useCreateRepair,
  useDecideQuote,
  useSaveQuote,
  useTechnicians,
  useTransitionRepair,
} from './api';

/** Field-level message from a 400/422 response, if the API sent one for `path`. */
function fieldError(error: unknown, path: string): string | undefined {
  return error instanceof ApiError
    ? error.details.find((d) => d.path === path)?.message
    : undefined;
}

// --- Book a device in --------------------------------------------------------------

/** Searches active customer devices (only those can be booked in). */
function DevicePicker({
  value,
  onChange,
  error,
}: {
  value: Asset | null;
  onChange: (asset: Asset | null) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebounced(query.trim(), 200);
  const lookup = useQuery({
    queryKey: ['assets', 'picker', search],
    queryFn: ({ signal }) =>
      api<Paginated<Asset>>(
        `/assets${toQueryString({ status: 'ACTIVE', search, pageSize: 10, sort: 'assetTag:asc' })}`,
        { signal },
      ).then((r) => r.data),
    enabled: open,
  });
  return (
    <Combobox
      label="Device"
      required
      value={value}
      onChange={onChange}
      query={query}
      onQueryChange={setQuery}
      onOpenChange={setOpen}
      options={lookup.data ?? []}
      loading={lookup.isPending}
      placeholder="Asset tag, serial, model or customer"
      emptyText="No active customer devices match. Devices already in repair are not listed."
      listLabel="Devices"
      error={error}
      hint="Only active devices that belong to a customer can be booked in."
      renderValue={(a) => (
        <span className="block truncate">
          <span className="font-mono text-[13px]">{a.assetTag}</span> {a.manufacturer} {a.model}
          <span className="text-ink-subtle"> · {a.customer?.name}</span>
        </span>
      )}
      renderOption={(a) => (
        <span className="block">
          <span className="flex justify-between gap-3">
            <span className="truncate">
              {a.manufacturer} {a.model}
            </span>
            <span className="font-mono text-[12px] text-ink-subtle">{a.assetTag}</span>
          </span>
          <span className="block truncate text-[12px] text-ink-subtle">
            {a.customer?.name}
            {a.serialNumber ? ` · ${a.serialNumber}` : ''}
          </span>
        </span>
      )}
    />
  );
}

function TechnicianSelect({
  value,
  onChange,
  optional,
  error,
  exclude,
}: {
  value: string;
  onChange: (id: string) => void;
  optional?: boolean;
  error?: string;
  exclude?: string | null;
}) {
  const technicians = useTechnicians();
  const options = (technicians.data ?? [])
    .filter((t) => t.id !== exclude)
    .map((t) => ({
      value: t.id,
      label: `${t.fullName} (${t.openJobs} open ${t.openJobs === 1 ? 'job' : 'jobs'})`,
    }));
  return (
    <SelectField
      label="Technician"
      required={!optional}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      disabled={technicians.isPending}
      options={[
        { value: '', label: optional ? 'Assign later' : 'Choose a technician' },
        ...options,
      ]}
      hint={technicians.isError ? 'Could not load technicians.' : undefined}
    />
  );
}

function NewRepairForm({ asset: preset, onClose }: { asset?: Asset; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateRepair(useIdempotencyKey());
  const [asset, setAsset] = useState<Asset | null>(preset ?? null);
  const [fault, setFault] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [errors, setErrors] = useState<{ asset?: string; fault?: string }>({});

  const submit = () => {
    const next = {
      asset: asset ? undefined : 'Choose the device',
      fault: fault.trim().length < 5 ? 'Describe the fault in a few words' : undefined,
    };
    setErrors(next);
    if (next.asset || next.fault || !asset) return;
    create.mutate(
      { assetId: asset.id, faultDescription: fault.trim(), technicianId: technicianId || null },
      {
        onSuccess: (repair) => {
          onClose();
          void navigate(`/repairs/${repair.id}`);
        },
      },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={create.error} />
        {preset ? (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
            <span className="font-mono text-[13px]">{preset.assetTag}</span> {preset.manufacturer}{' '}
            {preset.model}
            <span className="text-ink-subtle"> · {preset.customer?.name}</span>
          </p>
        ) : (
          <DevicePicker
            value={asset}
            onChange={setAsset}
            error={errors.asset ?? fieldError(create.error, 'assetId')}
          />
        )}
        <TextAreaField
          label="Fault reported"
          required
          rows={4}
          maxLength={2000}
          value={fault}
          onChange={(e) => setFault(e.target.value)}
          error={errors.fault ?? fieldError(create.error, 'faultDescription')}
          hint="In the customer's words. The customer sees this in the portal."
        />
        <TechnicianSelect
          optional
          value={technicianId}
          onChange={setTechnicianId}
          error={fieldError(create.error, 'technicianId')}
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={create.isPending}>
          Book in
        </Button>
      </DialogFooter>
    </>
  );
}

export function NewRepairDialog({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Book a device in for repair"
      description="The device is marked as in repair until the job is closed."
      width="max-w-lg"
    >
      {open && <NewRepairForm asset={asset} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Assign ----------------------------------------------------------------------------

function AssignForm({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const assign = useAssignRepair(repair.id, useIdempotencyKey());
  const [technicianId, setTechnicianId] = useState('');
  const [error, setError] = useState<string>();
  const submit = () => {
    if (!technicianId) return setError('Choose a technician');
    assign.mutate({ technicianId, version: repair.version }, { onSuccess: onClose });
  };
  return (
    <>
      <div className="space-y-4">
        <FormError error={assign.error} />
        <TechnicianSelect
          value={technicianId}
          onChange={(id) => {
            setTechnicianId(id);
            setError(undefined);
          }}
          exclude={repair.technician?.id}
          error={error}
        />
        {repair.technician && (
          <p className="text-[13px] text-ink-muted">
            {repair.technician.fullName} will no longer see this job.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={assign.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={assign.isPending}>
          {repair.technician ? 'Reassign' : 'Assign'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AssignDialog({
  repair,
  open,
  onOpenChange,
}: {
  repair: Repair;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${repair.technician ? 'Reassign' : 'Assign'} ${repair.reference}`}
    >
      {open && <AssignForm repair={repair} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Status moves ------------------------------------------------------------------------

/** The button text for a move, from the technician's point of view. */
export function moveLabel(rule: Pick<RepairTransitionRule, 'from' | 'to'>): string {
  switch (rule.to) {
    case 'DIAGNOSING':
      return rule.from === 'QUOTE_REJECTED' ? 'Revise diagnosis' : 'Start diagnosis';
    case 'IN_REPAIR':
      return rule.from === 'APPROVED'
        ? 'Start repair'
        : rule.from === 'AWAITING_PARTS'
          ? 'Resume repair'
          : 'Fail quality check';
    case 'AWAITING_PARTS':
      return 'Wait for parts';
    case 'QUALITY_CHECK':
      return 'Send to quality check';
    case 'COMPLETED':
      return 'Mark completed';
    case 'CLOSED':
      return 'Close: handed back';
    case 'RETURNED_UNREPAIRED':
      return 'Return unrepaired';
    case 'CANCELLED':
      return 'Cancel job';
    default:
      return `Move to ${REPAIR_STATUS_LABELS[rule.to].toLowerCase()}`;
  }
}

const NOTE_HINTS: Partial<Record<string, string>> = {
  AWAITING_PARTS: 'Which part, and from where? Staff only.',
  CANCELLED: 'Why is the job being cancelled? Staff only.',
  IN_REPAIR: 'What happened? Staff only.',
};

function MoveForm({
  repair,
  rule,
  onClose,
}: {
  repair: Repair;
  rule: RepairTransitionRule;
  onClose: () => void;
}) {
  const move = useTransitionRepair(repair.id, useIdempotencyKey());
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState('');
  const [errors, setErrors] = useState<{ note?: string; summary?: string }>({});
  const needsNote = rule.requires.includes('note');
  const needsSummary = rule.requires.includes('completionSummary');
  const needsLabour = rule.requires.includes('labour') && repair.labourMinutes === 0;
  const finishing = ['CLOSED', 'RETURNED_UNREPAIRED', 'CANCELLED'].includes(rule.to);

  const submit = () => {
    const next = {
      note: needsNote && !note.trim() ? 'Give a reason for this change' : undefined,
      summary: needsSummary && !summary.trim() ? 'Summarise the work done' : undefined,
    };
    setErrors(next);
    if (next.note || next.summary) return;
    move.mutate(
      {
        to: rule.to,
        note: note.trim() || null,
        completionSummary: summary.trim() || null,
        version: repair.version,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={move.error} />
        {needsLabour && (
          <p
            className="rounded-md bg-warning-bg px-3 py-2 text-[13px] text-warning-fg"
            role="alert"
          >
            Record the time spent first. A job needs labour before quality check.
          </p>
        )}
        {needsSummary && (
          <TextAreaField
            label="Completion summary"
            required
            rows={3}
            maxLength={2000}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            error={errors.summary ?? fieldError(move.error, 'completionSummary')}
            hint="What was done. The customer sees this in the portal."
          />
        )}
        <TextAreaField
          label={needsNote ? 'Reason' : 'Note (optional)'}
          required={needsNote}
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note ?? fieldError(move.error, 'note')}
          hint={NOTE_HINTS[rule.to] ?? 'Recorded in the job history. Staff only.'}
        />
        {finishing && (
          <p className="text-[13px] text-ink-muted">
            The job is finished after this and the device returns to active. This cannot be undone.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={move.isPending}>
          Back
        </Button>
        <Button
          variant={rule.to === 'CANCELLED' ? 'danger' : 'primary'}
          onClick={submit}
          loading={move.isPending}
          disabled={needsLabour}
        >
          {moveLabel(rule)}
        </Button>
      </DialogFooter>
    </>
  );
}

export function MoveDialog({
  repair,
  rule,
  onOpenChange,
}: {
  repair: Repair;
  rule: RepairTransitionRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={rule !== null}
      onOpenChange={onOpenChange}
      title={rule ? `${moveLabel(rule)}: ${repair.reference}` : ''}
      description={
        rule ? `${REPAIR_STATUS_LABELS[rule.from]} → ${REPAIR_STATUS_LABELS[rule.to]}` : undefined
      }
    >
      {rule && <MoveForm repair={repair} rule={rule} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Labour -----------------------------------------------------------------------------

function LabourForm({ repair, onClose }: { repair: Repair; onClose: () => void }) {
  const add = useAddLabour(repair.id, useIdempotencyKey());
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [workDate, setWorkDate] = useState(todayIso());
  const [errors, setErrors] = useState<{ time?: string; description?: string }>({});

  const submit = () => {
    const total = Number(hours || 0) * 60 + Number(minutes || 0);
    const next = {
      time:
        !Number.isInteger(total) || total < 1 || total > 1440
          ? 'Enter between 1 minute and 24 hours'
          : undefined,
      description: description.trim() ? undefined : 'Describe the work',
    };
    setErrors(next);
    if (next.time || next.description) return;
    add.mutate(
      { minutes: total, description: description.trim(), workDate },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={add.error} />
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">
            Time spent <span className="text-danger-fg">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Hours"
              type="number"
              min={0}
              max={24}
              inputMode="numeric"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <TextField
              label="Minutes"
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          {errors.time && (
            <p className="mt-1.5 text-[13px] text-danger-fg" role="alert">
              {errors.time}
            </p>
          )}
        </fieldset>
        <TextField
          label="Work done"
          required
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description ?? fieldError(add.error, 'description')}
        />
        <TextField
          label="Date"
          type="date"
          required
          max={todayIso()}
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
          error={fieldError(add.error, 'workDate')}
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={add.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={add.isPending}>
          Record time
        </Button>
      </DialogFooter>
    </>
  );
}

export function LabourDialog({
  repair,
  open,
  onOpenChange,
}: {
  repair: Repair;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Record time on ${repair.reference}`}>
      {open && <LabourForm repair={repair} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

// --- Quotation editor ----------------------------------------------------------------------

interface LineDraft {
  key: string;
  kind: QuoteLineKind;
  description: string;
  quantity: string;
  /** Rand amount as typed, e.g. "450" or "1299,99". */
  unitPrice: string;
}

const MONEY_PATTERN = /^\d{1,7}([.,]\d{1,2})?$/;
const QUANTITY_PATTERN = /^\d{1,5}([.,]\d{1,2})?$/;

/** "1 299,99" or "1299.99" -> 129999 cents; null when not a valid amount. */
export function parseRandToCents(text: string): number | null {
  const clean = text.replace(/\s/g, '');
  if (!MONEY_PATTERN.test(clean)) return null;
  const [whole = '0', fraction = ''] = clean.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function parseQuantity(text: string): number | null {
  const clean = text.replace(/\s/g, '');
  if (!QUANTITY_PATTERN.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return value > 0 ? value : null;
}

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2);
}

let lineCounter = 0;
const newLine = (kind: QuoteLineKind = 'LABOUR'): LineDraft => ({
  key: `line-${(lineCounter += 1)}`,
  kind,
  description: '',
  quantity: '1',
  unitPrice: '',
});

export function QuoteEditor({
  repair,
  quote,
  vatRateBasisPoints,
  currency,
  onClose,
}: {
  repair: Repair;
  quote: Quotation | null;
  vatRateBasisPoints: number;
  currency: string;
  onClose: () => void;
}) {
  const save = useSaveQuote(repair.id, useIdempotencyKey());
  const [lines, setLines] = useState<LineDraft[]>(() =>
    quote && quote.lines.length > 0
      ? quote.lines.map((l) => ({
          key: l.id,
          kind: l.kind,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: centsToText(l.unitPriceCents),
        }))
      : [newLine('LABOUR'), newLine('PART')],
  );
  const [note, setNote] = useState(quote?.customerNote ?? '');
  const [showErrors, setShowErrors] = useState(false);

  const parsed = lines.map((l) => ({
    ...l,
    qty: parseQuantity(l.quantity),
    cents: parseRandToCents(l.unitPrice),
  }));
  const valid = parsed.every((l) => l.description.trim() && l.qty !== null && l.cents !== null);
  const priced = parsed
    .filter((l) => l.qty !== null && l.cents !== null)
    .map((l) => ({ quantityHundredths: toHundredths(l.qty!), unitPriceCents: l.cents! }));
  const totals = quoteTotals(priced, vatRateBasisPoints);
  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    setShowErrors(true);
    if (!valid) return;
    const body = {
      lines: parsed.map((l) => ({
        kind: l.kind,
        description: l.description.trim(),
        quantity: l.qty!,
        unitPriceCents: l.cents!,
      })),
      customerNote: note.trim() || null,
    };
    save.mutate(
      quote
        ? { quoteId: quote.id, body: { ...body, version: quote.version } }
        : { quoteId: null, body },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={save.error} />
        <div className="space-y-3">
          {parsed.map((l, i) => (
            <div
              key={l.key}
              className="grid grid-cols-[110px_1fr] gap-2 rounded-md border border-line p-3 sm:grid-cols-[110px_1fr_80px_110px_auto]"
              role="group"
              aria-label={`Line ${i + 1}`}
            >
              <SelectField
                label="Type"
                value={l.kind}
                onChange={(e) => update(l.key, { kind: e.target.value as QuoteLineKind })}
                options={QUOTE_LINE_KINDS.map((k) => ({
                  value: k,
                  label: QUOTE_LINE_KIND_LABELS[k],
                }))}
              />
              <TextField
                label="Description"
                maxLength={300}
                value={l.description}
                onChange={(e) => update(l.key, { description: e.target.value })}
                error={showErrors && !l.description.trim() ? 'Describe the line' : undefined}
              />
              <TextField
                label={l.kind === 'LABOUR' ? 'Hours' : 'Qty'}
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => update(l.key, { quantity: e.target.value })}
                error={showErrors && l.qty === null ? 'Invalid' : undefined}
              />
              <TextField
                label="Unit price (R)"
                inputMode="decimal"
                placeholder="0.00"
                value={l.unitPrice}
                onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                error={showErrors && l.cents === null ? 'Invalid' : undefined}
              />
              <div className="col-span-2 flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-end">
                <span className="text-sm tabular-nums" aria-label={`Line ${i + 1} total`}>
                  {l.qty !== null && l.cents !== null
                    ? formatMoney(lineTotalCents(toHundredths(l.qty), l.cents), currency)
                    : '—'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => setLines((ls) => [...ls, newLine('PART')])}
            disabled={lines.length >= MAX_QUOTE_LINES}
          >
            <Plus size={14} aria-hidden="true" /> Add line
          </Button>
        </div>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Quotation totals">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Subtotal (excl. VAT)</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotalCents, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">VAT {vatRateBasisPoints / 100}%</dt>
            <dd className="tabular-nums">{formatMoney(totals.vatCents, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(totals.totalCents, currency)}</dd>
          </div>
        </dl>

        <TextAreaField
          label="Note to the customer (optional)"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="For example how long the price is valid or the warranty on parts."
        />
        <p className="text-[13px] text-ink-muted">
          Saving keeps this as a draft. The customer sees it only after you issue it.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={save.isPending}>
          Save draft
        </Button>
      </DialogFooter>
    </>
  );
}

export function QuoteEditorDialog({
  repair,
  quote,
  open,
  onOpenChange,
}: {
  repair: Repair;
  quote: Quotation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useCompanySettings();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={quote ? `Edit draft quotation (revision ${quote.revision})` : 'New quotation'}
      description="Prices exclude VAT. VAT is added once on the subtotal."
      width="max-w-3xl"
    >
      {open &&
        (settings.data || quote ? (
          <QuoteEditor
            repair={repair}
            quote={quote}
            vatRateBasisPoints={settings.data?.vatRateBasisPoints ?? quote!.vatRateBasisPoints}
            currency={settings.data?.currency ?? quote!.currency}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <FormError error={settings.error} />
        ))}
    </Dialog>
  );
}

// --- Decision on the customer's behalf ---------------------------------------------------------

function DecisionForm({
  repair,
  quote,
  approve,
  onClose,
}: {
  repair: Repair;
  quote: Quotation;
  approve: boolean;
  onClose: () => void;
}) {
  const decide = useDecideQuote(repair.id, useIdempotencyKey());
  const [channel, setChannel] = useState<(typeof ON_BEHALF_CHANNELS)[number] | ''>('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ channel?: string; note?: string }>({});

  const submit = () => {
    const next = {
      channel: channel ? undefined : 'Choose how the customer told you',
      note: note.trim() ? undefined : 'Record who decided and what they said',
    };
    setErrors(next);
    if (next.channel || next.note || !channel) return;
    decide.mutate(
      { quoteId: quote.id, approve, body: { version: quote.version, channel, note: note.trim() } },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <FormError error={decide.error} />
        <p className="text-sm text-ink-muted">
          Revision {quote.revision} for{' '}
          <strong className="text-ink">{formatMoney(quote.totalCents, quote.currency)}</strong>{' '}
          incl. VAT.{' '}
          {approve
            ? 'Approving lets the technician start the repair.'
            : 'The job moves to quote rejected.'}{' '}
          The customer sees in the portal that this was recorded on their behalf.
        </p>
        <SelectField
          label="How did the customer tell you?"
          required
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
          error={errors.channel}
          options={[
            { value: '', label: 'Choose…' },
            ...ON_BEHALF_CHANNELS.map((c) => ({ value: c, label: DECISION_CHANNEL_LABELS[c] })),
          ]}
        />
        <TextAreaField
          label="Note"
          required
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={errors.note ?? fieldError(decide.error, 'note')}
          hint="Who decided, and anything they said. Staff only."
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={decide.isPending}>
          Back
        </Button>
        <Button
          variant={approve ? 'primary' : 'danger'}
          onClick={submit}
          loading={decide.isPending}
        >
          {approve ? 'Record approval' : 'Record rejection'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DecisionDialog({
  repair,
  quote,
  approve,
  onOpenChange,
}: {
  repair: Repair;
  quote: Quotation | null;
  approve: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={quote !== null}
      onOpenChange={onOpenChange}
      title={`${approve ? 'Approve' : 'Reject'} on the customer's behalf`}
      description={`${repair.reference} · ${repair.customer.name}`}
    >
      {quote && (
        <DecisionForm
          repair={repair}
          quote={quote}
          approve={approve}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}
