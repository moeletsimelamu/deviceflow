import { Link } from 'react-router';
import { History } from 'lucide-react';
import { auditActionLabel, type AuditEntry } from '@deviceflow/shared';
import { EmptyState, ErrorState, Skeleton } from '../../design/States';
import { Pagination } from '../../design/Pagination';
import { formatDateTime } from '../../lib/format';
import { useActivity, type ActivityFilters } from './api';

/** Bookkeeping fields that change on every update and are not worth showing. */
const IGNORED_FIELDS = new Set(['updatedAt', 'version', 'createdAt', 'assetCount']);

type Snapshot = Record<string, unknown> | null;

function asSnapshot(value: unknown): Snapshot {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    const named = value as { name?: unknown; fullName?: unknown };
    if (typeof named.name === 'string') return named.name;
    if (typeof named.fullName === 'string') return named.fullName;
    return JSON.stringify(value);
  }
  return String(value);
}

/** Field-level differences between the before and after snapshots of an entry. */
export function changedFields(entry: Pick<AuditEntry, 'before' | 'after'>) {
  const before = asSnapshot(entry.before);
  const after = asSnapshot(entry.after);
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((k) => !IGNORED_FIELDS.has(k))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, from: display(before[k]), to: display(after[k]) }));
}

function humanise(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function entityLink(entry: AuditEntry): string | null {
  if (entry.repairJobId) return `/repairs/${entry.repairJobId}`;
  if (entry.entityType === 'Asset' && entry.assetId) return `/assets/${entry.assetId}`;
  if (entry.entityType === 'Part') return `/inventory/parts/${entry.entityId}`;
  if (entry.customerAccountId) return `/customers/${entry.customerAccountId}`;
  return null;
}

function EntryRow({ entry, showTarget }: { entry: AuditEntry; showTarget: boolean }) {
  const changes = changedFields(entry);
  const link = showTarget ? entityLink(entry) : null;
  const after = asSnapshot(entry.after);
  const target =
    typeof after?.reference === 'string'
      ? after.reference
      : entry.repairJobId
        ? 'repair job'
        : typeof after?.assetTag === 'string'
          ? after.assetTag
          : typeof after?.name === 'string'
            ? after.name
            : typeof after?.fullName === 'string'
              ? after.fullName
              : null;

  return (
    <li className="flex gap-3 px-5 py-3">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{entry.actor?.fullName ?? 'System'}</span>{' '}
          <span className="text-ink-muted">{auditActionLabel(entry.action).toLowerCase()}</span>
          {showTarget && target && (
            <>
              {' '}
              {link ? (
                <Link to={link} className="font-medium text-accent hover:underline">
                  {target}
                </Link>
              ) : (
                <span className="font-medium">{target}</span>
              )}
            </>
          )}
        </p>
        {changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-muted">
            {changes.slice(0, 6).map((c) => (
              <li key={c.field} className="break-words">
                {humanise(c.field)}:{' '}
                <span className="line-through decoration-ink-subtle/60">{c.from}</span> →{' '}
                <span className="text-ink">{c.to}</span>
              </li>
            ))}
            {changes.length > 6 && <li>and {changes.length - 6} more changes</li>}
          </ul>
        )}
        <p className="mt-0.5 text-[12px] text-ink-subtle">
          <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
          {entry.requestId && (
            <span className="ml-2 font-mono" title="Request ID">
              {entry.requestId.slice(0, 8)}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/** A paginated activity list for a filter (an asset, a customer, or everything). */
export function ActivityFeed({
  filters,
  onPage,
  showTarget = true,
  emptyText = 'Nothing has been recorded yet.',
}: {
  filters: ActivityFilters;
  onPage?: (page: number) => void;
  showTarget?: boolean;
  emptyText?: string;
}) {
  const activity = useActivity(filters);

  if (activity.isPending) {
    return (
      <div className="space-y-3 px-5 py-4" role="status" aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (activity.isError) {
    return <ErrorState error={activity.error} onRetry={() => activity.refetch()} />;
  }
  if (activity.data.data.length === 0) {
    return <EmptyState icon={History} title="No activity" description={emptyText} />;
  }
  return (
    <>
      <ol className={`divide-y divide-line ${activity.isPlaceholderData ? 'opacity-60' : ''}`}>
        {activity.data.data.map((entry) => (
          <EntryRow key={entry.id} entry={entry} showTarget={showTarget} />
        ))}
      </ol>
      {onPage && <Pagination meta={activity.data.meta} onPage={onPage} />}
    </>
  );
}
