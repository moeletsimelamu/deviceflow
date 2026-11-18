import type { ReactNode } from 'react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { ApiError } from '../lib/api';
import { cn } from './cn';

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin', className)}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-sunken', className)} aria-hidden="true" />;
}

/** Placeholder rows while a table loads; keeps the layout from jumping. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 px-4 py-3.5">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-3.5', c === 0 ? 'w-48' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-10 place-items-center rounded-md border border-line bg-sunken text-ink-muted">
        <Icon size={18} aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * What to tell the user about an error. API errors carry a message written for
 * people; anything else (a bug in the page) has a technical message, which goes
 * to the console instead.
 */
export function userMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong on this page. Reload it, and if it keeps happening, tell your administrator.';
}

/** Explains a failed load and offers a retry. Shows the request ID support can trace. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = userMessage(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid size-10 place-items-center rounded-md bg-danger-bg text-danger-fg">
        <AlertTriangle size={18} aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-semibold">This could not be loaded</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
      {requestId && (
        <p className="mt-2 font-mono text-2xs text-ink-subtle">Reference: {requestId}</p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Inline error banner for forms. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = userMessage(error);
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-danger-fg/25 bg-danger-bg px-3 py-2.5 text-sm text-danger-fg"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
