import { describe, expect, it } from 'vitest';
import {
  availableRepairMoves,
  CLOSED_REPAIR_STATUSES,
  findRepairRule,
  hasAtMostTwoDecimals,
  isRepairOpen,
  lineTotalCents,
  quoteLineInputSchema,
  quoteTotals,
  REPAIR_STATUSES,
  REPAIR_TRANSITIONS,
  repairActorsFor,
  toHundredths,
  vatCents,
} from './index.js';

describe('money', () => {
  it('prices lines in integer cents, rounding half-up', () => {
    expect(lineTotalCents(150, 45_000)).toBe(67_500); // 1.5 h at R450.00
    expect(lineTotalCents(100, 1)).toBe(1);
    expect(lineTotalCents(50, 1)).toBe(1); // 0.5 cent rounds up
    expect(lineTotalCents(49, 1)).toBe(0);
    expect(lineTotalCents(33, 10)).toBe(3); // 3.3 cents
  });

  it('calculates VAT once on the subtotal, rounded half-up to the cent', () => {
    expect(vatCents(10_000, 1500)).toBe(1_500);
    expect(vatCents(10, 1500)).toBe(2); // 1.5 cents -> 2
    expect(vatCents(9, 1500)).toBe(1); // 1.35 cents -> 1
    expect(vatCents(12_345, 0)).toBe(0);
  });

  it('adds up a quotation', () => {
    const totals = quoteTotals(
      [
        { quantityHundredths: 150, unitPriceCents: 45_000 },
        { quantityHundredths: 100, unitPriceCents: 129_999 },
      ],
      1500,
    );
    expect(totals).toEqual({ subtotalCents: 197_499, vatCents: 29_625, totalCents: 227_124 });
  });

  it('avoids floating-point drift in quantities', () => {
    expect(toHundredths(0.29)).toBe(29);
    expect(toHundredths(1.1)).toBe(110);
    expect(hasAtMostTwoDecimals(0.29)).toBe(true);
    expect(hasAtMostTwoDecimals(1.005)).toBe(false);
  });

  it('validates quotation lines', () => {
    const ok = quoteLineInputSchema.safeParse({
      kind: 'LABOUR',
      description: 'Screen replacement',
      quantity: 1.25,
      unitPriceCents: 45_000,
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { quantity: 0 },
      { quantity: 1.234 },
      { unitPriceCents: -1 },
      { unitPriceCents: 10.5 },
      { description: '  ' },
    ]) {
      const result = quoteLineInputSchema.safeParse({
        kind: 'PART',
        description: 'Battery',
        quantity: 1,
        unitPriceCents: 100,
        ...bad,
      });
      expect(result.success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('repair state machine', () => {
  it('has no duplicate moves and only known statuses', () => {
    const keys = REPAIR_TRANSITIONS.map((r) => `${r.from}->${r.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of REPAIR_TRANSITIONS) {
      expect(REPAIR_STATUSES).toContain(r.from);
      expect(REPAIR_STATUSES).toContain(r.to);
      expect(r.actors.length).toBeGreaterThan(0);
    }
  });

  it('never leaves a finished job', () => {
    for (const status of CLOSED_REPAIR_STATUSES) {
      expect(REPAIR_TRANSITIONS.filter((r) => r.from === status)).toEqual([]);
      expect(isRepairOpen(status)).toBe(false);
    }
  });

  it('approves and rejects only through the quotation actions', () => {
    expect(findRepairRule('AWAITING_APPROVAL', 'APPROVED')?.via).toBe('approve_quote');
    expect(findRepairRule('AWAITING_APPROVAL', 'QUOTE_REJECTED')?.via).toBe('reject_quote');
    expect(findRepairRule('DIAGNOSING', 'AWAITING_APPROVAL')?.via).toBe('issue_quote');
    expect(findRepairRule('SUBMITTED', 'ASSIGNED')?.via).toBe('assign');
  });

  it('allows cancelling only before approval', () => {
    const cancellable = REPAIR_TRANSITIONS.filter((r) => r.to === 'CANCELLED').map((r) => r.from);
    expect(cancellable.sort()).toEqual(
      ['ASSIGNED', 'AWAITING_APPROVAL', 'DIAGNOSING', 'QUOTE_REJECTED', 'SUBMITTED'].sort(),
    );
    expect(findRepairRule('SUBMITTED', 'CANCELLED')?.actors).toContain('CUSTOMER');
    expect(findRepairRule('ASSIGNED', 'CANCELLED')?.actors).not.toContain('CUSTOMER');
  });

  it('works out who is acting', () => {
    const job = { assignedTechnicianId: 'tech-1', customerAccountId: 'acct-1' };
    expect(repairActorsFor({ id: 'a', role: 'ADMIN' }, job)).toEqual(['ADMIN']);
    expect(repairActorsFor({ id: 'tech-1', role: 'TECHNICIAN' }, job)).toEqual([
      'ASSIGNED_TECHNICIAN',
    ]);
    expect(repairActorsFor({ id: 'tech-2', role: 'TECHNICIAN' }, job)).toEqual([]);
    expect(
      repairActorsFor({ id: 'c', role: 'CUSTOMER', customerAccountId: 'acct-1' }, job),
    ).toEqual(['CUSTOMER']);
    expect(
      repairActorsFor({ id: 'c', role: 'CUSTOMER', customerAccountId: 'acct-2' }, job),
    ).toEqual([]);
  });

  it('offers the assigned technician their next moves only', () => {
    const job = { status: 'IN_REPAIR' as const, assignedTechnicianId: 't', customerAccountId: 'c' };
    const moves = availableRepairMoves(job, { id: 't', role: 'TECHNICIAN' }).map((r) => r.to);
    expect(moves.sort()).toEqual(['AWAITING_PARTS', 'QUALITY_CHECK']);
    expect(availableRepairMoves(job, { id: 'x', role: 'TECHNICIAN' })).toEqual([]);
    // APPROVED -> IN_REPAIR is the assigned technician's move, not an administrator's.
    expect(
      availableRepairMoves({ ...job, status: 'APPROVED' }, { id: 'a', role: 'ADMIN' }).map(
        (r) => r.to,
      ),
    ).toEqual([]);
  });
});
