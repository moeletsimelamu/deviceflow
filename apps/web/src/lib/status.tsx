import {
  ASSET_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  PORTAL_REPAIR_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
  REPAIR_STATUS_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_STATE_LABELS,
  type AssetStatus,
  type CustomerType,
  type QuotationStatus,
  type RepairStatus,
  type StockMovementType,
  type StockState,
} from '@deviceflow/shared';
import { Badge, type Tone } from '../design/Badge';

/**
 * The single lookup from asset status to tone (DESIGN.md: a status always
 * looks the same everywhere it appears).
 */
export const ASSET_STATUS_TONES: Record<AssetStatus, Tone> = {
  IN_STOCK: 'neutral',
  ACTIVE: 'success',
  IN_REPAIR: 'info',
  REFURBISHING: 'warning',
  RETIRED: 'neutral',
  DISPOSED: 'danger',
};

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return (
    <Badge tone={ASSET_STATUS_TONES[status]} dot>
      {ASSET_STATUS_LABELS[status]}
    </Badge>
  );
}

export function CustomerTypeBadge({ type }: { type: CustomerType }) {
  return (
    <Badge tone={type === 'ORGANISATION' ? 'info' : 'neutral'}>{CUSTOMER_TYPE_LABELS[type]}</Badge>
  );
}

/** Warranty state relative to today, from a YYYY-MM-DD date. */
export function WarrantyBadge({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  if (!expiresOn) return <span className="text-ink-subtle">None recorded</span>;
  return expiresOn >= today ? (
    <Badge tone="success">In warranty</Badge>
  ) : (
    <Badge tone="neutral">Expired</Badge>
  );
}

/**
 * Repair status tones: info while work is under way, warning while waiting on
 * someone else (approval, parts), success when done, danger for a rejection.
 */
export const REPAIR_STATUS_TONES: Record<RepairStatus, Tone> = {
  SUBMITTED: 'neutral',
  ASSIGNED: 'info',
  DIAGNOSING: 'info',
  AWAITING_APPROVAL: 'warning',
  APPROVED: 'accent',
  QUOTE_REJECTED: 'danger',
  IN_REPAIR: 'info',
  AWAITING_PARTS: 'warning',
  QUALITY_CHECK: 'accent',
  COMPLETED: 'success',
  CLOSED: 'neutral',
  RETURNED_UNREPAIRED: 'neutral',
  CANCELLED: 'neutral',
};

export function RepairStatusBadge({
  status,
  portal = false,
}: {
  status: RepairStatus;
  /** Use the customer-facing wording. */
  portal?: boolean;
}) {
  return (
    <Badge tone={REPAIR_STATUS_TONES[status]} dot>
      {portal ? PORTAL_REPAIR_STATUS_LABELS[status] : REPAIR_STATUS_LABELS[status]}
    </Badge>
  );
}

export const QUOTATION_STATUS_TONES: Record<QuotationStatus, Tone> = {
  DRAFT: 'neutral',
  ISSUED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
  WITHDRAWN: 'neutral',
};

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge tone={QUOTATION_STATUS_TONES[status]}>{QUOTATION_STATUS_LABELS[status]}</Badge>;
}

export const STOCK_STATE_TONES: Record<StockState, Tone> = {
  OK: 'success',
  LOW: 'warning',
  OUT: 'danger',
};

export function StockStateBadge({ state }: { state: StockState }) {
  return (
    <Badge tone={STOCK_STATE_TONES[state]} dot>
      {STOCK_STATE_LABELS[state]}
    </Badge>
  );
}

/** Receipts are green, issues neutral, write-downs amber. */
export const STOCK_MOVEMENT_TONES: Record<StockMovementType, Tone> = {
  PURCHASE: 'success',
  ADJUSTMENT_IN: 'info',
  ADJUSTMENT_OUT: 'warning',
  REPAIR_CONSUMPTION: 'neutral',
  REPAIR_RETURN: 'info',
};

export function StockMovementBadge({ type }: { type: StockMovementType }) {
  return <Badge tone={STOCK_MOVEMENT_TONES[type]}>{STOCK_MOVEMENT_TYPE_LABELS[type]}</Badge>;
}
