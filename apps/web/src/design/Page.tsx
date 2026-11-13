import type { ReactNode } from 'react';
import { cn } from './cn';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      {children}
    </section>
  );
}

/** Table styles shared by every data list. */
export const table = {
  wrap: 'overflow-x-auto',
  table: 'w-full border-collapse text-sm',
  th: 'h-9 border-b border-line bg-canvas px-4 text-left text-[12px] font-medium text-ink-subtle whitespace-nowrap',
  td: 'h-12 border-b border-line px-4 align-middle',
  row: 'hover:bg-canvas/70',
};

/** Title bar inside a panel, with optional actions on the right. */
export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/** Label/value pairs for record details. Empty values show an em dash. */
export function DetailList({
  items,
  columns = 2,
}: {
  items: Array<[label: string, value: ReactNode]>;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-4 px-5 py-4',
        columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '',
      )}
    >
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[12px] font-medium text-ink-subtle">{label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink">
            {value === null || value === undefined || value === '' ? (
              <span className="text-ink-subtle">—</span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
