import { useState } from 'react';
import type { CustomerSummary } from '@deviceflow/shared';
import { Combobox } from '../../design/Combobox';
import { useDebounced } from '../../lib/hooks';
import { useCustomerLookup } from './api';

/**
 * Searchable customer selector. Searches active accounts on the server, so it
 * works with thousands of customers.
 */
export function CustomerPicker({
  label,
  value,
  onChange,
  error,
  hint,
  required,
}: {
  label: string;
  value: CustomerSummary | null;
  onChange: (customer: CustomerSummary | null) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebounced(query.trim(), 200);
  const lookup = useCustomerLookup(search, open);

  return (
    <Combobox
      label={label}
      value={value}
      onChange={onChange}
      query={query}
      onQueryChange={setQuery}
      onOpenChange={setOpen}
      options={lookup.data ?? []}
      loading={lookup.isPending}
      placeholder="Search by name or account number"
      emptyText="No active customers match."
      listLabel="Customers"
      error={error}
      hint={hint}
      required={required}
      renderValue={(c) => (
        <span className="block truncate">
          {c.name} <span className="font-mono text-[12px] text-ink-subtle">{c.accountNumber}</span>
        </span>
      )}
      renderOption={(c) => (
        <span className="flex items-center justify-between gap-3">
          <span className="truncate">{c.name}</span>
          <span className="font-mono text-[12px] text-ink-subtle">{c.accountNumber}</span>
        </span>
      )}
    />
  );
}
