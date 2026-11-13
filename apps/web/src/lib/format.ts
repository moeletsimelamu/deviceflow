/** South African English formatting (decision D3: ZAR). */
const LOCALE = 'en-ZA';

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** Integer cents → "R 1 234,50" style currency string. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(cents / 100);
}

const dateOnly = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar date ("2026-11-12") → "12 Nov 2026". Read as UTC so it never shifts a day. */
export function formatDate(date: string): string {
  return dateOnly.format(new Date(`${date}T00:00:00Z`));
}

/** Today's date as YYYY-MM-DD in the browser's time zone. */
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
