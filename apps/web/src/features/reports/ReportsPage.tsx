import { useState } from 'react';
import { Link } from 'react-router';
import {
  addDays,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  daysInRange,
  MAX_REPORT_DAYS,
  REPAIR_STATUS_LABELS,
  type InventoryReport,
  type OperationsReport,
  type ReportBucket,
} from '@deviceflow/shared';
import { useCan } from '../auth/session';
import { PageHeader, Panel, PanelHeader } from '../../design/Page';
import { FilterInput, FilterSelect } from '../../design/Field';
import { ErrorState, Skeleton } from '../../design/States';
import { cn } from '../../design/cn';
import { formatMoney } from '../../lib/format';
import { StockStateBadge } from '../../lib/status';
import { formatMinutes } from '../repairs/RepairDetailPage';
import { useInventoryReport, useOperationsReport, type ReportRangeInput } from './api';
import { BarList, ChartCard, ColumnChart, DataTable, StatTile, type ColumnPoint } from './charts';

// --- Range presets ---------------------------------------------------------------------

/** Today in UTC: report days are UTC calendar days, like the API. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
] as const;
type Preset = (typeof PRESETS)[number]['value'];

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): ReportRangeInput {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = (year: number, month: number) =>
    new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  switch (preset) {
    case '7':
    case '30':
    case '90':
      return { from: addDays(today, -(Number(preset) - 1)), to: today };
    case 'month':
      return { from: first(y, m), to: today };
    case 'last-month':
      return { from: first(y, m - 1), to: addDays(first(y, m), -1) };
    case 'year':
      return { from: `${y}-01-01`, to: today };
  }
}

// --- Formatting -----------------------------------------------------------------------------

const LOCALE = 'en-ZA';
const dayShort = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayLong = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthShort = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function bucketLabels(start: string, bucket: ReportBucket): { label: string; title: string } {
  const d = new Date(`${start}T00:00:00Z`);
  if (bucket === 'month') return { label: monthShort.format(d), title: monthLong.format(d) };
  if (bucket === 'week')
    return { label: dayShort.format(d), title: `Week of ${dayLong.format(d)}` };
  return { label: dayShort.format(d), title: dayLong.format(d) };
}

/** Hours under two days, days after that. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return '—';
  // The API rounds to a tenth of an hour (6 minutes).
  if (hours === 0) return 'under 6 min';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} h`;
  return `${(hours / 24).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} days`;
}

function compactMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

const count = (n: number) => n.toLocaleString(LOCALE);
const SERIES_OPENED = { name: 'Booked in', color: 'var(--df-chart-1)' };
const SERIES_COMPLETED = { name: 'Completed', color: 'var(--df-chart-2)' };
const SERIES_REVENUE = { name: 'Billed revenue', color: 'var(--df-chart-1)' };

// --- Sections ---------------------------------------------------------------------------------

function OperationsSection({ report, dimmed }: { report: OperationsReport; dimmed: boolean }) {
  const { currency, range } = report;
  const money = (cents: number) => formatMoney(cents, currency);
  const points: ColumnPoint[] = report.trend.map((p) => ({
    key: p.start,
    ...bucketLabels(p.start, range.bucket),
    values: [p.opened, p.completed],
  }));
  const revenuePoints: ColumnPoint[] = report.trend.map((p) => ({
    key: p.start,
    ...bucketLabels(p.start, range.bucket),
    values: [p.revenueCents],
  }));
  const per = range.bucket === 'day' ? 'Day' : range.bucket === 'week' ? 'Week' : 'Month';

  return (
    <section aria-labelledby="ops-heading" className={cn('space-y-5', dimmed && 'opacity-60')}>
      <h2 id="ops-heading" className="sr-only">
        Repairs and revenue
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <StatTile
          label="Billed revenue (excl. VAT)"
          value={money(report.revenue.subtotalCents)}
          detail={`${money(report.revenue.totalCents)} incl. VAT · ${count(report.revenue.jobs)} ${report.revenue.jobs === 1 ? 'job' : 'jobs'}`}
        />
        <StatTile
          label="Jobs completed"
          value={count(report.jobs.completed)}
          detail={`${count(report.jobs.opened)} booked in`}
        />
        <StatTile
          label="Average turnaround"
          value={formatDuration(report.turnaround.averageHours)}
          detail={
            report.turnaround.jobs > 0
              ? `Median ${formatDuration(report.turnaround.medianHours)}, booking in to completion`
              : 'No jobs completed in this range'
          }
        />
        <StatTile
          label="Open jobs now"
          value={count(report.jobs.openNow)}
          detail={`${count(report.jobs.abandoned)} cancelled or returned unrepaired in range`}
        />
        <StatTile
          label="Devices"
          value={count(report.devices.total)}
          detail={`${count(report.devices.registered)} registered in range`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Jobs booked in and completed"
          description={`Per ${per.toLowerCase()}, counted on the day of booking in and of completion.`}
          chart={
            <ColumnChart
              label="Jobs booked in and completed"
              points={points}
              series={[SERIES_OPENED, SERIES_COMPLETED]}
              format={count}
            />
          }
          tableView={
            <DataTable
              columns={[
                { label: per },
                { label: 'Booked in', numeric: true },
                { label: 'Completed', numeric: true },
              ]}
              rows={points.map((p) => ({ key: p.key, cells: [p.title, p.values[0], p.values[1]] }))}
            />
          }
        />
        <ChartCard
          title="Billed revenue (excl. VAT)"
          description="Approved quotations, counted when the job is completed."
          chart={
            <ColumnChart
              label="Billed revenue excluding VAT"
              points={revenuePoints}
              series={[SERIES_REVENUE]}
              format={money}
              formatTick={(v) => compactMoney(v, currency)}
            />
          }
          tableView={
            <DataTable
              columns={[{ label: per }, { label: 'Billed (excl. VAT)', numeric: true }]}
              rows={revenuePoints.map((p) => ({
                key: p.key,
                cells: [p.title, money(p.values[0] ?? 0)],
              }))}
            />
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Open jobs by status"
          description="Now, in workflow order."
          chart={
            <BarList
              label="Open jobs by status"
              rows={report.statusDistribution.map((s) => ({
                key: s.status,
                label: REPAIR_STATUS_LABELS[s.status],
                value: s.count,
              }))}
            />
          }
          tableView={
            <DataTable
              columns={[{ label: 'Status' }, { label: 'Jobs', numeric: true }]}
              rows={report.statusDistribution.map((s) => ({
                key: s.status,
                cells: [REPAIR_STATUS_LABELS[s.status], s.count],
              }))}
            />
          }
        />
        <ChartCard
          title="Devices by status"
          description="Every registered device, now."
          chart={
            <BarList
              label="Devices by status"
              rows={ASSET_STATUSES.map((s) => ({
                key: s,
                label: ASSET_STATUS_LABELS[s],
                value: report.devices.byStatus[s],
              }))}
            />
          }
          tableView={
            <DataTable
              columns={[{ label: 'Status' }, { label: 'Devices', numeric: true }]}
              rows={ASSET_STATUSES.map((s) => ({
                key: s,
                cells: [ASSET_STATUS_LABELS[s], report.devices.byStatus[s]],
              }))}
            />
          }
        />
      </div>

      <Panel>
        <PanelHeader
          title="Technician workload"
          description="Open jobs now (not counting completed jobs waiting for collection); jobs completed and time recorded in the range."
        />
        {report.technicians.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-muted">No technicians yet.</p>
        ) : (
          <DataTable
            columns={[
              { label: 'Technician' },
              { label: 'Open', numeric: true },
              { label: 'Completed', numeric: true },
              { label: 'Time', numeric: true },
            ]}
            rows={report.technicians.map((t) => ({
              key: t.id,
              cells: [
                <span key="n">
                  {t.fullName}
                  {!t.isActive && (
                    <span className="ml-2 text-[12px] text-ink-subtle">Deactivated</span>
                  )}
                </span>,
                t.openJobs,
                t.completedJobs,
                t.labourMinutes > 0 ? formatMinutes(t.labourMinutes) : '—',
              ],
            }))}
          />
        )}
      </Panel>
    </section>
  );
}

function InventorySection({ report, dimmed }: { report: InventoryReport; dimmed: boolean }) {
  const money = (cents: number) => formatMoney(cents, report.currency);
  const { consumption, stock } = report;
  return (
    <section aria-labelledby="inv-heading" className={cn('space-y-5', dimmed && 'opacity-60')}>
      <h2 id="inv-heading" className="text-base font-semibold">
        Inventory
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Parts used on repairs"
          value={money(consumption.costCents)}
          detail={`${count(consumption.units)} ${consumption.units === 1 ? 'unit' : 'units'} on ${count(consumption.jobs)} ${consumption.jobs === 1 ? 'job' : 'jobs'}, net of returns`}
        />
        <StatTile
          label="Stock received"
          value={money(report.receipts.costCents)}
          detail={`${count(report.receipts.units)} ${report.receipts.units === 1 ? 'unit' : 'units'}`}
        />
        <StatTile
          label="Stock value now"
          value={money(stock.valueCents)}
          detail={`${count(stock.units)} units of ${count(stock.parts)} parts, at average cost`}
        />
        <StatTile
          label="Low stock now"
          value={count(stock.lowStock)}
          detail={
            stock.outOfStock > 0
              ? `Including ${count(stock.outOfStock)} out of stock`
              : 'None out of stock'
          }
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Most used parts"
          description="By cost, net of returns, in the range."
          chart={
            consumption.top.length === 0 ? (
              <p className="text-sm text-ink-muted">No parts were used on repairs in this range.</p>
            ) : (
              <BarList
                label="Most used parts by cost"
                rows={consumption.top.map((p) => ({
                  key: p.part.id,
                  label: p.part.name,
                  value: p.costCents,
                  display: money(p.costCents),
                }))}
              />
            )
          }
          tableView={
            <DataTable
              columns={[
                { label: 'Part' },
                { label: 'SKU' },
                { label: 'Units', numeric: true },
                { label: 'Cost', numeric: true },
              ]}
              rows={consumption.top.map((p) => ({
                key: p.part.id,
                cells: [
                  p.part.name,
                  <span key="s" className="font-mono text-[12px]">
                    {p.part.sku}
                  </span>,
                  p.units,
                  money(p.costCents),
                ],
              }))}
            />
          }
        />
        <Panel>
          <PanelHeader title="At or below reorder level" description="Now, least in stock first." />
          {report.lowStockParts.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              Every part is above its reorder level.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {report.lowStockParts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <Link
                    to={`/inventory/parts/${p.id}`}
                    className="min-w-0 truncate text-sm hover:text-accent hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-sm">
                    <StockStateBadge state={p.stockState} />
                    <span className="font-medium tabular-nums">{p.quantityOnHand}</span>
                    <span className="text-[12px] text-ink-subtle">/ {p.reorderLevel}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

// --- Page -------------------------------------------------------------------------------------------

export function ReportsPage() {
  const canOperations = useCan('reports:operations');
  const canInventory = useCan('reports:inventory');
  const today = todayUtc();
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState<ReportRangeInput>(presetRange('30', today));
  const range = preset === 'custom' ? custom : presetRange(preset, today);
  const customError =
    preset !== 'custom'
      ? null
      : !custom.from || !custom.to
        ? 'Choose both dates'
        : custom.from > custom.to
          ? 'The start date must be on or before the end date'
          : daysInRange(custom.from, custom.to) > MAX_REPORT_DAYS
            ? `A report can cover at most ${MAX_REPORT_DAYS} days`
            : null;
  const valid = customError === null;
  const operations = useOperationsReport(range, canOperations && valid);
  const inventory = useInventoryReport(range, canInventory && valid);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Repairs, revenue and stock for a date range. Days are counted in UTC."
      />
      <div
        className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
        role="search"
        aria-label="Report range"
      >
        <FilterSelect
          aria-label="Date range"
          value={preset}
          onChange={(e) => {
            const next = e.target.value as Preset;
            if (next === 'custom') setCustom(range);
            setPreset(next);
          }}
          options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        />
        {preset === 'custom' && (
          <>
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              From
              <FilterInput
                type="date"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              To
              <FilterInput
                type="date"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </label>
          </>
        )}
        <p className="text-[13px] text-ink-muted" aria-live="polite">
          {customError ??
            `${dayLong.format(new Date(`${range.from}T00:00:00Z`))} to ${dayLong.format(new Date(`${range.to}T00:00:00Z`))}`}
        </p>
      </div>

      <div className="space-y-8">
        {canOperations &&
          (operations.isPending && valid ? (
            <ReportSkeleton />
          ) : operations.isError ? (
            <ErrorState error={operations.error} onRetry={() => operations.refetch()} />
          ) : operations.data ? (
            <OperationsSection report={operations.data} dimmed={operations.isPlaceholderData} />
          ) : null)}
        {canInventory &&
          (inventory.isPending && valid ? (
            <ReportSkeleton />
          ) : inventory.isError ? (
            <ErrorState error={inventory.error} onRetry={() => inventory.refetch()} />
          ) : inventory.data ? (
            <InventorySection report={inventory.data} dimmed={inventory.isPlaceholderData} />
          ) : null)}
      </div>

      <p className="mt-8 max-w-3xl text-[12px] text-ink-subtle">
        {canOperations &&
          'Billed revenue is the approved quotation value of jobs completed in the range; DeviceFlow does not record payments. Turnaround runs from booking in to completion. '}
        Parts are counted net of returns, at the cost recorded when they moved.
      </p>
    </>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading report">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
