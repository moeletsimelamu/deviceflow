/**
 * Money arithmetic in integer cents (Phase 1, D3).
 *
 * - Quotation lines are priced excluding VAT.
 * - Quantities are stored as hundredths (1.5 hours = 150), so every calculation
 *   stays in integers and no floating-point rounding can creep into a total.
 * - VAT is calculated once per quotation on the subtotal and rounded half-up to
 *   the cent. Rounding per line instead would let the VAT drift by a few cents
 *   from what the customer can recompute from the subtotal.
 *
 * All values are non-negative, so "add half and floor" is half-up rounding.
 */

/** The largest quotation subtotal accepted: R10 000 000.00. Keeps totals within a 32-bit column. */
export const MAX_QUOTE_SUBTOTAL_CENTS = 1_000_000_000;

export function lineTotalCents(quantityHundredths: number, unitPriceCents: number): number {
  return Math.floor((quantityHundredths * unitPriceCents + 50) / 100);
}

export function vatCents(subtotalCents: number, vatRateBasisPoints: number): number {
  return Math.floor((subtotalCents * vatRateBasisPoints + 5_000) / 10_000);
}

export interface QuoteTotals {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

export function quoteTotals(
  lines: ReadonlyArray<{ quantityHundredths: number; unitPriceCents: number }>,
  vatRateBasisPoints: number,
): QuoteTotals {
  const subtotal = lines.reduce(
    (sum, line) => sum + lineTotalCents(line.quantityHundredths, line.unitPriceCents),
    0,
  );
  const vat = vatCents(subtotal, vatRateBasisPoints);
  return { subtotalCents: subtotal, vatCents: vat, totalCents: subtotal + vat };
}

/** 1.5 -> 150. Inputs are validated to at most two decimals before this is called. */
export function toHundredths(quantity: number): number {
  return Math.round(quantity * 100);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

/** True when a number has at most two decimal places (tolerating binary float noise). */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
