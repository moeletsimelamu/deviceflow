import { Link } from 'react-router';
import type { StockMovement } from '@deviceflow/shared';
import { table } from '../../design/Page';
import { cn } from '../../design/cn';
import { formatDateTime, formatMoney } from '../../lib/format';
import { StockMovementBadge } from '../../lib/status';

function Change({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'font-medium whitespace-nowrap tabular-nums',
        value > 0 ? 'text-success-fg' : 'text-ink',
      )}
    >
      {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
    </span>
  );
}

/** What the movement was for: the job, the supplier and invoice, or the reason. */
function Detail({ m, linkJobs }: { m: StockMovement; linkJobs: boolean }) {
  const text = [m.supplier, m.reference].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 text-[13px]">
      {m.repairJob &&
        (linkJobs ? (
          <Link
            to={`/repairs/${m.repairJob.id}`}
            className="font-mono font-medium text-accent hover:underline"
          >
            {m.repairJob.reference}
          </Link>
        ) : (
          <span className="font-mono">{m.repairJob.reference}</span>
        ))}
      {text && <p className="truncate">{text}</p>}
      {m.note && <p className="max-w-[320px] truncate text-ink-muted">{m.note}</p>}
    </div>
  );
}

/**
 * The stock ledger. `showPart` adds the part column (the all-parts ledger and
 * repair jobs); `showBalance` adds the running balance (one part's ledger).
 */
export function MovementTable({
  movements,
  currency,
  showPart = true,
  showBalance = false,
  linkJobs = true,
  dimmed,
}: {
  movements: StockMovement[];
  currency: string;
  showPart?: boolean;
  showBalance?: boolean;
  /** Link job references (off for roles that cannot open repair jobs). */
  linkJobs?: boolean;
  dimmed?: boolean;
}) {
  return (
    // On a phone the table scrolls sideways. A movement row may contain no link,
    // so the wrapper itself takes keyboard focus, letting arrow keys scroll it.
    <div
      className={cn(
        table.wrap,
        'focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none',
      )}
      tabIndex={0}
      role="region"
      aria-label="Stock movements"
    >
      <table className={table.table}>
        <thead>
          <tr>
            <th className={cn(table.th, 'max-sm:hidden')} scope="col">
              When
            </th>
            {showPart && (
              <th className={table.th} scope="col">
                Part
              </th>
            )}
            <th className={cn(table.th, showPart && 'max-sm:hidden')} scope="col">
              Movement
            </th>
            <th className={cn(table.th, 'text-right')} scope="col">
              Units
            </th>
            {showBalance && (
              <th className={cn(table.th, 'text-right')} scope="col">
                Balance
              </th>
            )}
            <th className={cn(table.th, 'text-right max-md:hidden')} scope="col">
              Unit cost
            </th>
            <th className={cn(table.th, 'max-lg:hidden')} scope="col">
              Details
            </th>
            <th className={cn(table.th, 'max-sm:hidden')} scope="col">
              By
            </th>
          </tr>
        </thead>
        <tbody className={dimmed ? 'opacity-60' : undefined}>
          {movements.map((m) => (
            <tr key={m.id} className={table.row}>
              <td
                className={cn(
                  table.td,
                  'text-[13px] whitespace-nowrap text-ink-muted max-sm:hidden',
                )}
              >
                {formatDateTime(m.createdAt)}
              </td>
              {showPart && (
                <td className={cn(table.td, 'py-2')}>
                  <Link
                    to={`/inventory/parts/${m.part.id}`}
                    className="block max-w-[240px] truncate font-medium text-ink hover:text-accent hover:underline max-sm:max-w-[190px]"
                  >
                    {m.part.name}
                  </Link>
                  <span className="font-mono text-[12px] text-ink-subtle">{m.part.sku}</span>
                  {/* On phones the movement and date columns fold into this cell. */}
                  <span className="mt-1 block sm:hidden">
                    <StockMovementBadge type={m.type} />
                    <span className="block text-[12px] text-ink-subtle">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </span>
                </td>
              )}
              <td className={cn(table.td, 'py-2', showPart && 'max-sm:hidden')}>
                <StockMovementBadge type={m.type} />
                {/* On phones the date column is hidden, so the date sits under the movement. */}
                <span className="block text-[12px] whitespace-nowrap text-ink-subtle sm:hidden">
                  {formatDateTime(m.createdAt)}
                </span>
              </td>
              <td className={cn(table.td, 'text-right')}>
                <Change value={m.quantityChange} />
              </td>
              {showBalance && (
                <td className={cn(table.td, 'text-right tabular-nums')}>{m.balanceAfter}</td>
              )}
              <td
                className={cn(table.td, 'text-right tabular-nums whitespace-nowrap max-md:hidden')}
              >
                {formatMoney(m.unitCostCents, currency)}
              </td>
              <td className={cn(table.td, 'py-2 max-lg:hidden')}>
                <Detail m={m} linkJobs={linkJobs} />
              </td>
              <td className={cn(table.td, 'whitespace-nowrap max-sm:hidden')}>
                {m.actor.fullName}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
