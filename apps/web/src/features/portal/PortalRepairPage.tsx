import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CheckCircle2, MessageSquare, Wrench } from 'lucide-react';
import {
  DECISION_CHANNEL_LABELS,
  PORTAL_REPAIR_STATUS_LABELS,
  QUOTE_LINE_KIND_LABELS,
  type PortalQuotation,
  type PortalRepair,
} from '@deviceflow/shared';
import { Panel, PanelHeader, table } from '../../design/Page';
import { Button } from '../../design/Button';
import { ConfirmDialog, Dialog, DialogFooter } from '../../design/Dialog';
import { TextAreaField } from '../../design/Field';
import { EmptyState, ErrorState, FormError, Skeleton } from '../../design/States';
import { cn } from '../../design/cn';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/hooks';
import { QuotationStatusBadge, RepairStatusBadge } from '../../lib/status';
import {
  useCancelRepair,
  usePortalDecision,
  usePortalRepair,
  usePortalRepairQuotes,
  usePortalRepairTimeline,
} from './api';

const STATUS_EXPLANATIONS: Partial<Record<PortalRepair['status'], string>> = {
  SUBMITTED: 'We have your request and will assign a technician shortly.',
  ASSIGNED: 'A technician has been assigned and will look at the device soon.',
  DIAGNOSING: 'A technician is finding the cause. You will receive a quotation to approve.',
  AWAITING_APPROVAL: 'Please review the quotation below. No paid work starts until you approve.',
  APPROVED: 'Thank you for approving. The repair will start shortly.',
  QUOTE_REJECTED: 'You declined the quotation. We will contact you about the next step.',
  IN_REPAIR: 'Your device is being repaired.',
  AWAITING_PARTS: 'We are waiting for parts to arrive.',
  QUALITY_CHECK: 'The repair is done and the device is being tested.',
  COMPLETED: 'Your device is repaired and ready for collection.',
  CLOSED: 'This repair is finished and the device has been collected.',
  RETURNED_UNREPAIRED: 'The device was returned without being repaired.',
  CANCELLED: 'This repair request was cancelled.',
};

function decisionText(q: PortalQuotation): string | null {
  if (!q.decidedAt || !q.decisionChannel) return null;
  const verb = q.status === 'APPROVED' ? 'Approved' : 'Declined';
  return q.onBehalf
    ? `${verb} on your behalf by our staff (${DECISION_CHANNEL_LABELS[q.decisionChannel].toLowerCase()}) on ${formatDateTime(q.decidedAt)}`
    : `${verb}${q.decidedByName ? ` by ${q.decidedByName}` : ''} on ${formatDateTime(q.decidedAt)}`;
}

function QuoteView({ quote }: { quote: PortalQuotation }) {
  return (
    <>
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
              <th className={cn(table.th, 'text-right')} scope="col">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.position}>
                <td className={cn(table.td, 'h-auto py-2')}>
                  {l.description}
                  <span className="block text-[12px] text-ink-subtle">
                    {QUOTE_LINE_KIND_LABELS[l.kind]} ·{' '}
                    {formatMoney(l.unitPriceCents, quote.currency)} each
                  </span>
                </td>
                <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums')}>
                  {l.quantity}
                </td>
                <td className={cn(table.td, 'h-auto py-2 text-right tabular-nums')}>
                  {formatMoney(l.lineTotalCents, quote.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto max-w-xs space-y-1 px-5 py-3 text-sm">
        <div className="flex justify-between gap-6">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(quote.subtotalCents, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-ink-muted">VAT {quote.vatRateBasisPoints / 100}%</dt>
          <dd className="tabular-nums">{formatMoney(quote.vatCents, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-6 border-t border-line pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(quote.totalCents, quote.currency)}</dd>
        </div>
      </dl>
      {quote.customerNote && (
        <p className="px-5 pb-4 text-[13px] text-ink-muted">{quote.customerNote}</p>
      )}
    </>
  );
}

function DeclineForm({
  repair,
  quote,
  onClose,
}: {
  repair: PortalRepair;
  quote: PortalQuotation;
  onClose: () => void;
}) {
  const decide = usePortalDecision(repair.id, useIdempotencyKey());
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="space-y-4">
        <FormError error={decide.error} />
        <p className="text-sm text-ink-muted">
          The repair will not go ahead at this price. We will contact you about returning the device
          or a different option.
        </p>
        <TextAreaField
          label="Reason (optional)"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Helps us suggest an alternative."
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={decide.isPending}>
          Back
        </Button>
        <Button
          variant="danger"
          loading={decide.isPending}
          onClick={() =>
            decide.mutate(
              {
                quoteId: quote.id,
                approve: false,
                version: quote.version,
                reason: reason.trim() || null,
              },
              { onSuccess: onClose },
            )
          }
        >
          Decline quotation
        </Button>
      </DialogFooter>
    </>
  );
}

function Decision({ repair, quote }: { repair: PortalRepair; quote: PortalQuotation }) {
  const approveKey = useIdempotencyKey();
  const approve = usePortalDecision(repair.id, approveKey);
  const [confirming, setConfirming] = useState(false);
  const [declining, setDeclining] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
      <Button onClick={() => setDeclining(true)}>Decline</Button>
      <Button variant="primary" onClick={() => setConfirming(true)}>
        <CheckCircle2 size={14} aria-hidden="true" /> Approve{' '}
        {formatMoney(quote.totalCents, quote.currency)}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) approve.reset();
        }}
        title={`Approve the quotation for ${repair.reference}?`}
        body={
          <p>
            You agree to pay{' '}
            <strong className="text-ink">{formatMoney(quote.totalCents, quote.currency)}</strong>{' '}
            including VAT for this repair. The technician will then start the work.
          </p>
        }
        confirmLabel="Approve quotation"
        tone="primary"
        pending={approve.isPending}
        error={approve.error}
        onConfirm={() =>
          approve.mutate(
            { quoteId: quote.id, approve: true, version: quote.version },
            { onSuccess: () => setConfirming(false) },
          )
        }
      />
      <Dialog
        open={declining}
        onOpenChange={setDeclining}
        title={`Decline the quotation for ${repair.reference}?`}
      >
        {declining && (
          <DeclineForm repair={repair} quote={quote} onClose={() => setDeclining(false)} />
        )}
      </Dialog>
    </div>
  );
}

function QuotesPanel({ repair }: { repair: PortalRepair }) {
  const quotes = usePortalRepairQuotes(repair.id);
  if (quotes.isPending) return <Skeleton className="h-32 w-full" />;
  if (quotes.isError) return <ErrorState error={quotes.error} onRetry={() => quotes.refetch()} />;
  if (quotes.data.length === 0) return null;
  const [latest, ...older] = quotes.data;
  if (!latest) return null;
  const open = latest.status === 'ISSUED' && repair.status === 'AWAITING_APPROVAL';
  const decided = decisionText(latest);

  return (
    <Panel className={open ? 'border-warning-fg/40' : undefined}>
      <PanelHeader
        title={open ? 'Quotation for your approval' : 'Quotation'}
        description={`Revision ${latest.revision}${latest.issuedAt ? `, sent ${formatDateTime(latest.issuedAt)}` : ''}`}
        actions={<QuotationStatusBadge status={latest.status} />}
      />
      <QuoteView quote={latest} />
      {decided && <p className="px-5 pb-4 text-sm font-medium">{decided}</p>}
      {latest.decisionNote && (
        <p className="px-5 pb-4 text-[13px] text-ink-muted">Your reason: “{latest.decisionNote}”</p>
      )}
      {open && <Decision repair={repair} quote={latest} />}
      {older.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer text-ink-muted">
            Earlier quotations ({older.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {older.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3">
                <span>
                  Revision {q.revision} · {formatMoney(q.totalCents, q.currency)}
                </span>
                <QuotationStatusBadge status={q.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function Timeline({ id }: { id: string }) {
  const timeline = usePortalRepairTimeline(id);
  if (timeline.isPending) return <Skeleton className="m-5 h-16" />;
  if (timeline.isError)
    return <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />;
  return (
    <ol className="divide-y divide-line">
      {timeline.data.map((e) => (
        <li key={e.id} className="flex gap-3 px-5 py-3 text-sm">
          {e.kind === 'message' ? (
            <MessageSquare size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          ) : (
            <Wrench size={15} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className={e.kind === 'message' ? 'whitespace-pre-line' : 'font-medium'}>
              {e.kind === 'message' ? e.body : PORTAL_REPAIR_STATUS_LABELS[e.toStatus]}
            </p>
            <time className="text-[12px] text-ink-subtle" dateTime={e.createdAt}>
              {formatDateTime(e.createdAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CancelForm({ repair, onClose }: { repair: PortalRepair; onClose: () => void }) {
  const cancel = useCancelRepair(repair.id, useIdempotencyKey());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  return (
    <>
      <div className="space-y-4">
        <FormError error={cancel.error} />
        <TextAreaField
          label="Why are you cancelling?"
          required
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={cancel.isPending}>
          Keep request
        </Button>
        <Button
          variant="danger"
          loading={cancel.isPending}
          onClick={() => {
            if (!reason.trim()) return setError('Tell us why you are cancelling');
            cancel.mutate(
              { reason: reason.trim(), version: repair.version },
              { onSuccess: onClose },
            );
          }}
        >
          Cancel request
        </Button>
      </DialogFooter>
    </>
  );
}

export function PortalRepairPage() {
  const { id = '' } = useParams();
  const repair = usePortalRepair(id);
  const [cancelling, setCancelling] = useState(false);

  return (
    <>
      <Link
        to="/portal/repairs"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> My repairs
      </Link>
      {repair.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : repair.isError ? (
        repair.error instanceof ApiError &&
        (repair.error.status === 404 || repair.error.status === 400) ? (
          <EmptyState
            icon={Wrench}
            title="Repair not found"
            description="This repair is not on your account."
          />
        ) : (
          <ErrorState error={repair.error} onRetry={() => repair.refetch()} />
        )
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">
                  {repair.data.device.manufacturer} {repair.data.device.model}
                </h1>
                <RepairStatusBadge status={repair.data.status} portal />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Repair <span className="font-mono">{repair.data.reference}</span> ·{' '}
                <Link
                  to={`/portal/devices/${repair.data.device.id}`}
                  className="font-mono hover:underline"
                >
                  {repair.data.device.assetTag}
                </Link>
              </p>
            </div>
            {repair.data.status === 'SUBMITTED' && (
              <Button variant="ghost" onClick={() => setCancelling(true)}>
                Cancel request
              </Button>
            )}
          </header>
          <p className="mb-5 rounded-md border border-line bg-canvas px-4 py-3 text-sm">
            {STATUS_EXPLANATIONS[repair.data.status]}
          </p>
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-5">
              <QuotesPanel repair={repair.data} />
              {repair.data.completionSummary && (
                <Panel>
                  <PanelHeader title="Work done" />
                  <p className="px-5 py-4 text-sm whitespace-pre-line">
                    {repair.data.completionSummary}
                  </p>
                </Panel>
              )}
              <Panel>
                <PanelHeader title="What you reported" />
                <p className="px-5 py-4 text-sm whitespace-pre-line">
                  {repair.data.faultDescription}
                </p>
              </Panel>
            </div>
            <Panel>
              <PanelHeader title="Progress" description="Newest first." />
              <Timeline id={repair.data.id} />
            </Panel>
          </div>
          <Dialog
            open={cancelling}
            onOpenChange={setCancelling}
            title={`Cancel ${repair.data.reference}?`}
          >
            {cancelling && <CancelForm repair={repair.data} onClose={() => setCancelling(false)} />}
          </Dialog>
        </>
      )}
    </>
  );
}
