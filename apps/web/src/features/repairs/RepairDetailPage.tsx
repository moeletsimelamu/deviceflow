import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FilePlus2,
  Pencil,
  Send,
  Trash2,
  UserCog,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  availableRepairMoves,
  DECISION_CHANNEL_LABELS,
  isRepairOpen,
  LABOUR_STATUSES,
  QUOTE_LINE_KIND_LABELS,
  QUOTE_STATUSES,
  REPAIR_NOTE_TYPE_LABELS,
  REPAIR_NOTE_TYPES,
  REPAIR_SOURCE_LABELS,
  REPAIR_STATUS_LABELS,
  TECHNICIAN_CHANGE_STATUSES,
  type Quotation,
  type Repair,
  type RepairNoteType,
  type RepairTransitionRule,
  type SessionUser,
} from '@deviceflow/shared';
import { useCan, useCurrentUser } from '../auth/session';
import { DetailList, Panel, PanelHeader, table } from '../../design/Page';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { ConfirmDialog } from '../../design/Dialog';
import { SelectField, TextAreaField } from '../../design/Field';
import { EmptyState, ErrorState, FormError, Skeleton } from '../../design/States';
import { cn } from '../../design/cn';
import { ApiError } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/hooks';
import { QuotationStatusBadge, RepairStatusBadge } from '../../lib/status';
import { ActivityFeed } from '../activity/ActivityFeed';
import {
  useAddNote,
  useDeleteLabour,
  useDeleteQuote,
  useIssueQuote,
  useRepair,
  useRepairHistory,
  useRepairLabour,
  useRepairNotes,
  useRepairQuotes,
} from './api';
import {
  AssignDialog,
  DecisionDialog,
  LabourDialog,
  MoveDialog,
  QuoteEditorDialog,
  moveLabel,
} from './RepairDialogs';
import { RepairPartsPanel } from './RepairPartsPanel';

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** What has to happen next, and who does it, in one sentence. */
function nextStep(repair: Repair, user: SessionUser): string | null {
  const mine = user.role === 'TECHNICIAN';
  switch (repair.status) {
    case 'SUBMITTED':
      return 'Assign a technician to start the job.';
    case 'ASSIGNED':
      return mine
        ? 'Start the diagnosis when you pick the device up.'
        : 'Waiting for the technician to start the diagnosis.';
    case 'DIAGNOSING':
      return 'Record what you find, then prepare and issue a quotation for the customer to approve.';
    case 'AWAITING_APPROVAL':
      return user.role === 'ADMIN'
        ? 'Waiting for the customer to approve or reject the quotation in the portal. If they tell you directly, record their decision on the quotation.'
        : 'Waiting for the customer to decide on the quotation. You can still issue a revised quotation.';
    case 'APPROVED':
      return mine
        ? 'The customer approved. Start the repair.'
        : 'The customer approved. Waiting for the technician to start the repair.';
    case 'QUOTE_REJECTED':
      return user.role === 'ADMIN'
        ? 'The quotation was rejected. Revise the diagnosis for a new quotation, or return the device unrepaired.'
        : 'The quotation was rejected. Revise the diagnosis to prepare a new quotation.';
    case 'IN_REPAIR':
      return 'Use parts from stock and record your time as you work. Send the job to quality check when the repair is done.';
    case 'AWAITING_PARTS':
      return 'Resume the repair when the parts arrive, and use them on the job.';
    case 'QUALITY_CHECK':
      return 'Test the device. Mark it completed with a summary for the customer, or send it back to repair.';
    case 'COMPLETED':
      return user.role === 'ADMIN'
        ? 'Close the job when the customer collects the device.'
        : 'Waiting for the customer to collect the device.';
    default:
      return null;
  }
}

// --- Quotations ------------------------------------------------------------------------

function QuoteLines({ quote }: { quote: Quotation }) {
  return (
    <div className={table.wrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={table.th} scope="col">
              Item
            </th>
            <th className={cn(table.th, 'text-right')} scope="col">
              Qty
            </th>
            <th className={cn(table.th, 'text-right max-sm:hidden')} scope="col">
              Unit price
            </th>
            <th className={cn(table.th, 'text-right')} scope="col">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l) => (
            <tr key={l.id}>
              <td className={cn(table.td, 'h-auto py-2')}>
                {l.description}
                <span className="ml-2 text-[12px] text-ink-subtle">
                  {QUOTE_LINE_KIND_LABELS[l.kind]}
                </span>
              </td>
              <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums')}>{l.quantity}</td>
              <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums max-sm:hidden')}>
                {formatMoney(l.unitPriceCents, quote.currency)}
              </td>
              <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums')}>
                {formatMoney(l.lineTotalCents, quote.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto max-w-xs space-y-1 px-4 py-3 text-sm">
        <div className="flex justify-between gap-6">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(quote.subtotalCents, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-ink-muted">VAT {quote.vatRateBasisPoints / 100}%</dt>
          <dd className="tabular-nums">{formatMoney(quote.vatCents, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(quote.totalCents, quote.currency)}</dd>
        </div>
      </dl>
    </div>
  );
}

function decisionText(q: Quotation): string | null {
  if (!q.decidedAt || !q.decisionChannel) return null;
  const verb = q.status === 'APPROVED' ? 'Approved' : 'Rejected';
  const when = formatDateTime(q.decidedAt);
  return q.onBehalf
    ? `${verb} on the customer's behalf by ${q.decidedBy?.fullName ?? 'staff'} (${DECISION_CHANNEL_LABELS[q.decisionChannel]}), ${when}`
    : `${verb} by ${q.decidedBy?.fullName ?? 'the customer'} in the portal, ${when}`;
}

function QuoteCard({
  repair,
  quote,
  canWork,
  canManage,
}: {
  repair: Repair;
  quote: Quotation;
  canWork: boolean;
  canManage: boolean;
}) {
  const issueKey = useIdempotencyKey();
  const issue = useIssueQuote(repair.id, issueKey);
  const discard = useDeleteQuote(repair.id);
  const [editing, setEditing] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [decision, setDecision] = useState<boolean | null>(null);
  const draft = quote.status === 'DRAFT';
  const canQuote = canWork && QUOTE_STATUSES.includes(repair.status);
  const decidable = canManage && quote.status === 'ISSUED' && repair.status === 'AWAITING_APPROVAL';
  const decided = decisionText(quote);

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Revision {quote.revision}</span>
          <QuotationStatusBadge status={quote.status} />
          <span className="text-sm text-ink-muted tabular-nums">
            {formatMoney(quote.totalCents, quote.currency)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft && canQuote && (
            <>
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil size={13} aria-hidden="true" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(true)}>
                <Trash2 size={13} aria-hidden="true" /> Discard
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setConfirmIssue(true)}
                disabled={quote.lines.length === 0 || quote.totalCents === 0}
              >
                <Send size={13} aria-hidden="true" /> Issue to customer
              </Button>
            </>
          )}
          {decidable && (
            <>
              <Button size="sm" onClick={() => setDecision(false)}>
                <XCircle size={13} aria-hidden="true" /> Record rejection
              </Button>
              <Button size="sm" variant="primary" onClick={() => setDecision(true)}>
                <CheckCircle2 size={13} aria-hidden="true" /> Record approval
              </Button>
            </>
          )}
        </div>
      </div>
      {quote.status !== 'SUPERSEDED' && quote.status !== 'WITHDRAWN' ? (
        <>
          {quote.lines.length > 0 ? (
            <QuoteLines quote={quote} />
          ) : (
            <p className="px-5 pb-3 text-sm text-ink-muted">
              No lines yet. Edit the draft to add them.
            </p>
          )}
          {(quote.customerNote || decided || quote.issuedAt) && (
            <div className="space-y-1 px-5 pb-4 text-[13px] text-ink-muted">
              {quote.customerNote && <p>Note to customer: “{quote.customerNote}”</p>}
              {quote.issuedAt && (
                <p>
                  Issued by {quote.issuedBy?.fullName} on {formatDateTime(quote.issuedAt)}
                </p>
              )}
              {decided && <p className="font-medium text-ink">{decided}</p>}
              {quote.onBehalf && quote.decisionNote && <p>Staff note: “{quote.decisionNote}”</p>}
              {!quote.onBehalf && quote.decisionNote && (
                <p>Customer's reason: “{quote.decisionNote}”</p>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="px-5 pb-3 text-[13px] text-ink-subtle">
          {quote.status === 'SUPERSEDED'
            ? 'Replaced by a later revision.'
            : 'Withdrawn when the job was cancelled.'}
        </p>
      )}

      <QuoteEditorDialog repair={repair} quote={quote} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirmIssue}
        onOpenChange={(open) => {
          setConfirmIssue(open);
          if (!open) issue.reset();
        }}
        title={`Issue revision ${quote.revision} to ${repair.customer.name}?`}
        body={
          <>
            <p>
              The customer will be asked to approve{' '}
              <strong className="text-ink">{formatMoney(quote.totalCents, quote.currency)}</strong>{' '}
              incl. VAT. An issued quotation cannot be changed; a correction needs a new revision.
            </p>
            {repair.currentQuote?.status === 'ISSUED' && (
              <p>
                Revision {repair.currentQuote.revision} will be replaced and can no longer be
                approved.
              </p>
            )}
          </>
        }
        confirmLabel="Issue quotation"
        tone="primary"
        pending={issue.isPending}
        error={issue.error}
        onConfirm={() =>
          issue.mutate(
            { id: quote.id, version: quote.version },
            { onSuccess: () => setConfirmIssue(false) },
          )
        }
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={`Discard draft revision ${quote.revision}?`}
        body={<p>The draft and its lines are deleted. The customer never saw it.</p>}
        confirmLabel="Discard draft"
        pending={discard.isPending}
        error={discard.error}
        onConfirm={() => discard.mutate(quote.id, { onSuccess: () => setConfirmDiscard(false) })}
      />
      <DecisionDialog
        repair={repair}
        quote={decision === null ? null : quote}
        approve={decision === true}
        onOpenChange={(open) => !open && setDecision(null)}
      />
    </div>
  );
}

function QuotesPanel({
  repair,
  canWork,
  canManage,
}: {
  repair: Repair;
  canWork: boolean;
  canManage: boolean;
}) {
  const quotes = useRepairQuotes(repair.id);
  const [creating, setCreating] = useState(false);
  const hasDraft = quotes.data?.some((q) => q.status === 'DRAFT') ?? false;
  const canCreate = canWork && QUOTE_STATUSES.includes(repair.status) && !hasDraft;

  return (
    <Panel>
      <PanelHeader
        title="Quotation"
        description="Prices the customer approves before the repair starts."
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <FilePlus2 size={13} aria-hidden="true" />
              {quotes.data && quotes.data.length > 0 ? 'Revise quotation' : 'New quotation'}
            </Button>
          )
        }
      />
      {quotes.isPending ? (
        <Skeleton className="m-5 h-16" />
      ) : quotes.isError ? (
        <ErrorState error={quotes.error} onRetry={() => quotes.refetch()} />
      ) : quotes.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          {QUOTE_STATUSES.includes(repair.status) ||
          repair.status === 'ASSIGNED' ||
          repair.status === 'SUBMITTED'
            ? 'No quotation yet. One is prepared during diagnosis.'
            : 'No quotation was issued for this job.'}
        </p>
      ) : (
        quotes.data.map((q) => (
          <QuoteCard key={q.id} repair={repair} quote={q} canWork={canWork} canManage={canManage} />
        ))
      )}
      <QuoteEditorDialog repair={repair} quote={null} open={creating} onOpenChange={setCreating} />
    </Panel>
  );
}

// --- Labour ------------------------------------------------------------------------------

function LabourPanel({
  repair,
  canWork,
  user,
}: {
  repair: Repair;
  canWork: boolean;
  user: SessionUser;
}) {
  const labour = useRepairLabour(repair.id);
  const remove = useDeleteLabour(repair.id);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const open = canWork && LABOUR_STATUSES.includes(repair.status);

  return (
    <Panel>
      <PanelHeader
        title="Labour"
        description={`Time actually spent: ${formatMinutes(repair.labourMinutes)}.`}
        actions={
          open && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Clock size={13} aria-hidden="true" /> Record time
            </Button>
          )
        }
      />
      {labour.isPending ? (
        <Skeleton className="m-5 h-10" />
      ) : labour.isError ? (
        <ErrorState error={labour.error} onRetry={() => labour.refetch()} />
      ) : labour.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No time recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {labour.data.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate">{e.description}</p>
                <p className="text-[12px] text-ink-subtle">
                  {e.user.fullName} · {formatDate(e.workDate)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tabular-nums whitespace-nowrap">{formatMinutes(e.minutes)}</span>
                {open && (user.role === 'ADMIN' || e.user.id === user.id) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${formatMinutes(e.minutes)} on ${formatDate(e.workDate)}`}
                    onClick={() => setRemoving(e.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <LabourDialog repair={repair} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this labour entry?"
        body={<p>The entry is removed from the job. The activity log keeps a record of it.</p>}
        confirmLabel="Remove entry"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })
        }
      />
    </Panel>
  );
}

// --- Notes ----------------------------------------------------------------------------------

function NoteForm({ repair, onSaved }: { repair: Repair; onSaved: () => void }) {
  // The panel remounts this form after each saved note, so every note gets its own key.
  const add = useAddNote(repair.id, useIdempotencyKey());
  const [type, setType] = useState<RepairNoteType>('DIAGNOSTIC');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      className="space-y-3 border-b border-line px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return setError('Write the note');
        add.mutate({ type, body: body.trim() }, { onSuccess: onSaved });
      }}
    >
      <FormError error={add.error} />
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <SelectField
          label="Kind"
          value={type}
          onChange={(e) => setType(e.target.value as RepairNoteType)}
          options={REPAIR_NOTE_TYPES.map((t) => ({ value: t, label: REPAIR_NOTE_TYPE_LABELS[t] }))}
        />
        <TextAreaField
          label="Note"
          rows={2}
          maxLength={4000}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setError(undefined);
          }}
          error={error}
          hint={
            type === 'CUSTOMER_VISIBLE'
              ? 'The customer sees this message in the portal.'
              : 'Staff only. Notes cannot be edited once added.'
          }
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="primary" loading={add.isPending}>
          Add note
        </Button>
      </div>
    </form>
  );
}

function NotesPanel({ repair, canWork }: { repair: Repair; canWork: boolean }) {
  const notes = useRepairNotes(repair.id);
  const [formKey, setFormKey] = useState(0);
  return (
    <Panel>
      <PanelHeader title="Notes" description="Diagnosis, work done and messages to the customer." />
      {canWork && (
        <NoteForm key={formKey} repair={repair} onSaved={() => setFormKey((k) => k + 1)} />
      )}
      {notes.isPending ? (
        <Skeleton className="m-5 h-10" />
      ) : notes.isError ? (
        <ErrorState error={notes.error} onRetry={() => notes.refetch()} />
      ) : notes.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No notes yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {notes.data.map((n) => (
            <li key={n.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={n.type === 'CUSTOMER_VISIBLE' ? 'accent' : 'neutral'}>
                  {REPAIR_NOTE_TYPE_LABELS[n.type]}
                </Badge>
                <span className="text-[12px] text-ink-subtle">
                  {n.author.fullName} · {formatDateTime(n.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// --- History ----------------------------------------------------------------------------------

function HistoryPanel({ repairId }: { repairId: string }) {
  const history = useRepairHistory(repairId);
  return (
    <Panel>
      <PanelHeader title="Status history" description="Newest first. Cannot be edited." />
      {history.isPending ? (
        <Skeleton className="m-5 h-16" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : (
        <ol className="px-5 py-4">
          {history.data.map((h, i) => (
            <li key={h.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < history.data.length - 1 && (
                <span
                  className="absolute top-3 bottom-0 left-[4px] w-px bg-line"
                  aria-hidden="true"
                />
              )}
              <span
                className="relative mt-1.5 size-[9px] shrink-0 rounded-full border-2 border-accent bg-surface"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {h.fromStatus
                    ? `${REPAIR_STATUS_LABELS[h.fromStatus]} → ${REPAIR_STATUS_LABELS[h.toStatus]}`
                    : 'Submitted'}
                </p>
                {h.note && <p className="mt-0.5 text-[13px] text-ink-muted">“{h.note}”</p>}
                <p className="mt-0.5 text-[12px] text-ink-subtle">
                  {h.actor.fullName} ·{' '}
                  <time dateTime={h.createdAt}>{formatDateTime(h.createdAt)}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// --- Page --------------------------------------------------------------------------------------

function RepairBody({ repair }: { repair: Repair }) {
  const user = useCurrentUser();
  const canWork = useCan('repairs:work');
  const canManage = useCan('repairs:manage');
  const canSeeCustomers = useCan('customers:read');
  const canSeeAudit = useCan('audit:read');
  // Inventory managers see a job only for its parts: no notes, labour or quotations.
  const canReadDetails = useCan('repairs:read_details');
  const [assigning, setAssigning] = useState(false);
  const [move, setMove] = useState<RepairTransitionRule | null>(null);
  const [activityPage, setActivityPage] = useState(1);

  const moves = availableRepairMoves(
    {
      status: repair.status,
      assignedTechnicianId: repair.technician?.id ?? null,
      customerAccountId: repair.customer.id,
    },
    { id: user.id, role: user.role },
  );
  const forward = moves.filter((m) => m.to !== 'CANCELLED');
  const cancel = moves.find((m) => m.to === 'CANCELLED');
  const step = canReadDetails ? nextStep(repair, user) : null;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight">{repair.reference}</h1>
            <RepairStatusBadge status={repair.status} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {repair.asset.manufacturer} {repair.asset.model} · {repair.customer.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && TECHNICIAN_CHANGE_STATUSES.includes(repair.status) && (
            <Button
              onClick={() => setAssigning(true)}
              variant={repair.technician ? 'secondary' : 'primary'}
            >
              <UserCog size={14} aria-hidden="true" />
              {repair.technician ? 'Reassign' : 'Assign technician'}
            </Button>
          )}
          {cancel && (
            <Button variant="ghost" onClick={() => setMove(cancel)}>
              Cancel job
            </Button>
          )}
          {forward.map((m) => (
            <Button
              key={m.to}
              variant={m.to === 'IN_REPAIR' && m.from === 'QUALITY_CHECK' ? 'secondary' : 'primary'}
              onClick={() => setMove(m)}
            >
              {moveLabel(m)}
            </Button>
          ))}
        </div>
      </header>

      {step && isRepairOpen(repair.status) && (
        <p className="mb-5 flex gap-2 rounded-md border border-line bg-canvas px-4 py-3 text-sm">
          <Wrench size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span>
            <span className="font-medium">Next: </span>
            {step}
          </span>
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Fault" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <p className="whitespace-pre-line">{repair.faultDescription}</p>
              <p className="text-[12px] text-ink-subtle">
                {REPAIR_SOURCE_LABELS[repair.source]} by {repair.submittedBy.fullName},{' '}
                {formatDateTime(repair.createdAt)}
              </p>
              {repair.completionSummary && (
                <div className="rounded-md bg-success-bg px-3 py-2 text-success-fg">
                  <p className="text-[12px] font-medium">Completion summary</p>
                  <p className="whitespace-pre-line">{repair.completionSummary}</p>
                </div>
              )}
            </div>
          </Panel>
          {canReadDetails && (
            <QuotesPanel repair={repair} canWork={canWork} canManage={canManage} />
          )}
          <RepairPartsPanel repair={repair} />
          {canReadDetails && (
            <>
              <LabourPanel repair={repair} canWork={canWork} user={user} />
              <NotesPanel repair={repair} canWork={canWork} />
            </>
          )}
          <HistoryPanel repairId={repair.id} />
          {canSeeAudit && (
            <Panel>
              <PanelHeader title="Activity" description="Audit entries for this job." />
              <ActivityFeed
                filters={{ repairJobId: repair.id, page: activityPage, pageSize: 10 }}
                onPage={setActivityPage}
                showTarget={false}
              />
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Device" />
            <div className="px-5 py-4 text-sm">
              <Link
                to={`/assets/${repair.asset.id}`}
                className="font-mono font-medium text-accent hover:underline"
              >
                {repair.asset.assetTag}
              </Link>
              <p>
                {repair.asset.manufacturer} {repair.asset.model}
              </p>
              {repair.asset.serialNumber && (
                <p className="font-mono text-[12px] text-ink-subtle">{repair.asset.serialNumber}</p>
              )}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Customer" />
            <div className="space-y-2 px-5 py-4 text-sm">
              <div>
                {canSeeCustomers ? (
                  <Link
                    to={`/customers/${repair.customer.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {repair.customer.name}
                  </Link>
                ) : (
                  <span className="font-medium">{repair.customer.name}</span>
                )}
                <p className="font-mono text-[12px] text-ink-subtle">
                  {repair.customer.accountNumber}
                </p>
              </div>
              {repair.contact ? (
                <div>
                  <p>
                    {repair.contact.name}
                    {repair.contact.jobTitle && (
                      <span className="text-ink-subtle"> · {repair.contact.jobTitle}</span>
                    )}
                  </p>
                  {repair.contact.phone && (
                    <a
                      href={`tel:${repair.contact.phone}`}
                      className="block text-accent hover:underline"
                    >
                      {repair.contact.phone}
                    </a>
                  )}
                  {repair.contact.email && (
                    <a
                      href={`mailto:${repair.contact.email}`}
                      className="block truncate text-accent hover:underline"
                    >
                      {repair.contact.email}
                    </a>
                  )}
                </div>
              ) : canReadDetails ? (
                <p className="text-ink-subtle">No contact details recorded.</p>
              ) : null}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Job" />
            <DetailList
              columns={1}
              items={[
                ['Technician', repair.technician?.fullName ?? 'Unassigned'],
                ['Opened', formatDateTime(repair.createdAt)],
                ['Completed', repair.completedAt && formatDateTime(repair.completedAt)],
                ['Finished', repair.closedAt && formatDateTime(repair.closedAt)],
                ...(canReadDetails
                  ? ([
                      ['Labour', formatMinutes(repair.labourMinutes)],
                      [
                        'Quotation',
                        repair.currentQuote &&
                          `${formatMoney(repair.currentQuote.totalCents, repair.currentQuote.currency)} (revision ${repair.currentQuote.revision}, ${repair.currentQuote.status.toLowerCase()})`,
                      ],
                    ] as Array<[string, ReactNode]>)
                  : []),
              ]}
            />
          </Panel>
        </div>
      </div>

      <AssignDialog repair={repair} open={assigning} onOpenChange={setAssigning} />
      <MoveDialog repair={repair} rule={move} onOpenChange={(o) => !o && setMove(null)} />
    </>
  );
}

export function RepairDetailPage() {
  const { id = '' } = useParams();
  const repair = useRepair(id);
  return (
    <>
      <Link
        to="/repairs"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Repairs
      </Link>
      {repair.isPending ? (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : repair.isError ? (
        repair.error instanceof ApiError &&
        (repair.error.status === 404 || repair.error.status === 400) ? (
          <EmptyState
            icon={Wrench}
            title="Repair job not found"
            description="It may not exist, or it may be assigned to another technician."
          />
        ) : (
          <ErrorState error={repair.error} onRetry={() => repair.refetch()} />
        )
      ) : (
        <RepairBody repair={repair.data} />
      )}
    </>
  );
}
