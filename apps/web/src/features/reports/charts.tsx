import { useState, type ReactNode } from 'react';
import { cn } from '../../design/cn';
import { table } from '../../design/Page';

/*
 * Small, dependency-free charts for the reports page (DESIGN.md, Reports).
 *
 * - Marks: columns and bars at most 24px thick, 4px rounded data end, square at
 *   the baseline; a 2px gap between neighbouring marks; hairline solid gridlines.
 * - Series colours (--df-chart-1, --df-chart-2) are for marks only; every label,
 *   value and legend uses the ink tokens.
 * - Every value is reachable without a tooltip: each chart has a table view, and
 *   hover and keyboard focus show the same details.
 */

export interface Series {
  name: string;
  /** A CSS colour, normally var(--df-chart-N). */
  color: string;
}

/** 1, 2 or 5 × 10^k at or above `value`. */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const f = value / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/** Gridline values from 0 to a clean top, about three intervals. */
export function niceTicks(max: number, intervals = 3): number[] {
  const step = Math.max(1, niceStep(max / intervals));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-4 py-3.5">
      <p className="text-[12px] font-medium text-ink-subtle">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-[12px] text-ink-muted">{detail}</p>}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-label="Legend">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-[3px]"
            style={{ background: s.color }}
            aria-hidden="true"
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

export interface ColumnPoint {
  key: string;
  /** Short axis label, e.g. "12 Oct". */
  label: string;
  /** Long label for the tooltip and the table, e.g. "Week of 12 Oct 2026". */
  title: string;
  values: number[];
}

/**
 * Columns over time, one or two series side by side (never two y-scales).
 * Hovering or focusing a period shows its values; the whole column of the
 * period is the hit target.
 */
export function ColumnChart({
  label,
  points,
  series,
  format,
  formatTick = format,
  height = 176,
}: {
  label: string;
  points: ColumnPoint[];
  series: Series[];
  format: (value: number) => string;
  formatTick?: (value: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.flatMap((p) => p.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const every = Math.max(1, Math.ceil(points.length / 6));
  const current = active === null ? null : points[active];
  const place = active === null ? 0 : (active + 0.5) / points.length;

  return (
    <figure className="min-w-0" aria-label={label}>
      {series.length > 1 && (
        <div className="mb-3">
          <Legend series={series} />
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        {/* Y axis */}
        <div
          className="relative w-14 text-right text-[11px] text-ink-subtle tabular-nums"
          style={{ height }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${(1 - t / top) * 100}%` }}
            >
              {formatTick(t)}
            </span>
          ))}
        </div>
        {/* Plot */}
        <div className="relative" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-line-strong' : 'bg-line')}
              style={{ top: `${(1 - t / top) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          <div className="absolute inset-0 flex items-stretch" role="list">
            {points.map((p, i) => (
              <div
                key={p.key}
                role="listitem"
                tabIndex={0}
                aria-label={`${p.title}: ${series.map((s, j) => `${s.name} ${format(p.values[j] ?? 0)}`).join(', ')}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={cn(
                  'flex min-w-0 flex-1 items-end justify-center gap-[2px] px-[1px] outline-none focus-visible:bg-accent-soft',
                  active === i && 'bg-sunken/70',
                )}
              >
                {series.map((s, j) => {
                  const v = p.values[j] ?? 0;
                  return (
                    <span
                      key={s.name}
                      className="block min-w-0 flex-1 rounded-t-[4px]"
                      style={{
                        maxWidth: series.length > 1 ? 12 : 24,
                        height: v > 0 ? `${(v / top) * 100}%` : 0,
                        background: s.color,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {current && (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-[150px] rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-[0_6px_20px_-8px_rgb(28_25_23/0.35)]"
              // Beside the column, on the side with more room, so it never covers it.
              style={
                place < 0.5
                  ? { left: `calc(${((active! + 1) / points.length) * 100}% + 8px)` }
                  : { right: `calc(${(1 - active! / points.length) * 100}% + 8px)` }
              }
              role="status"
            >
              <p className="font-medium text-ink">{current.title}</p>
              {series.map((s, j) => (
                <p
                  key={s.name}
                  className="mt-0.5 flex items-center justify-between gap-4 text-ink-muted"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ background: s.color }}
                      aria-hidden="true"
                    />
                    {s.name}
                  </span>
                  <span className="font-medium text-ink tabular-nums">
                    {format(current.values[j] ?? 0)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
        {/* X axis */}
        <div />
        {/* First and last periods always; evenly spaced ones between on wider screens,
            skipping any too close to the last label to fit beside it. */}
        <div className="relative mt-1.5 h-4 text-[11px] text-ink-subtle" aria-hidden="true">
          {points.map((p, i) => {
            const last = points.length - 1;
            const edge = i === 0 || i === last;
            if (!edge && (i % every !== 0 || last - i < every * 0.7)) return null;
            return (
              <span
                key={p.key}
                className={cn(
                  'absolute whitespace-nowrap',
                  i === 0 ? 'left-0' : i === last ? 'right-0' : '-translate-x-1/2 max-sm:hidden',
                )}
                style={edge ? undefined : { left: `${((i + 0.5) / points.length) * 100}%` }}
              >
                {p.label}
              </span>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Shown at the tip instead of the plain number. */
  display?: string;
}

/**
 * Horizontal bars on one baseline, one hue, value at the tip. The order is the
 * caller's: workflow order for statuses, largest first for rankings.
 */
export function BarList({
  label,
  rows,
  color = 'var(--df-chart-1)',
}: {
  label: string;
  rows: BarRow[];
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-[13px] max-sm:grid-cols-[minmax(0,7rem)_1fr]"
        >
          <span className="truncate text-ink-muted">{r.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            {r.value > 0 && (
              <span
                className="block h-2.5 rounded-r-[4px]"
                style={{ width: `${(r.value / max) * 85}%`, background: color }}
                aria-hidden="true"
              />
            )}
            <span className="shrink-0 font-medium tabular-nums">{r.display ?? r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A chart card with a "Table" toggle, so no value is reachable only through the chart. */
export function ChartCard({
  title,
  description,
  chart,
  tableView,
  className,
}: {
  title: string;
  description?: ReactNode;
  chart: ReactNode;
  tableView: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn('min-w-0 rounded-lg border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"
        >
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      <div className={asTable ? undefined : 'px-5 pt-8 pb-4'}>{asTable ? tableView : chart}</div>
    </section>
  );
}

/** A plain data table for a chart's table view. */
export function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ label: string; numeric?: boolean }>;
  rows: Array<{ key: string; cells: ReactNode[] }>;
}) {
  return (
    <div className={cn(table.wrap, 'max-h-80 overflow-y-auto')}>
      <table className={table.table}>
        <thead className="sticky top-0">
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cn(table.th, c.numeric && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td
                  key={i}
                  className={cn(table.td, 'h-9', columns[i]?.numeric && 'text-right tabular-nums')}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
