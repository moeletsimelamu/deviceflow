import { useState } from 'react';
import { PageHeader, Panel } from '../../design/Page';
import { FilterInput, FilterSelect } from '../../design/Field';
import { ActivityFeed } from './ActivityFeed';
import type { ActivityFilters } from './api';

const AREAS = [
  { value: '', label: 'All activity' },
  { value: 'asset.', label: 'Assets' },
  { value: 'customer.', label: 'Customers' },
  { value: 'contact.', label: 'Customer contacts' },
  { value: 'customer_user.', label: 'Portal users' },
  { value: 'user.', label: 'Staff users' },
  { value: 'settings.', label: 'Settings' },
  { value: 'auth.', label: 'Sign-ins' },
];

export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilters>({ page: 1 });
  const set = (patch: Partial<ActivityFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every recorded business action: who did it, when, and what changed. Entries cannot be edited or deleted."
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <FilterSelect
            aria-label="Filter by area"
            value={filters.action ?? ''}
            onChange={(e) => set({ action: e.target.value || undefined })}
            options={AREAS}
          />
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            From
            <FilterInput
              type="date"
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(e) => set({ from: e.target.value || undefined })}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            To
            <FilterInput
              type="date"
              value={filters.to ?? ''}
              min={filters.from}
              onChange={(e) => set({ to: e.target.value || undefined })}
            />
          </label>
        </div>
        <ActivityFeed
          filters={filters}
          onPage={(page) => set({ page })}
          emptyText="No activity matches these filters."
        />
      </Panel>
    </>
  );
}
