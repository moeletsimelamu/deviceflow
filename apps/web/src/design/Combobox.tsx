import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { Spinner } from './States';

/**
 * Searchable single-value selector following the ARIA combobox pattern
 * (arrow keys, Enter, Escape). The caller does the searching, usually on the
 * server, so it works with any number of records.
 */
export function Combobox<T extends { id: string }>({
  label,
  value,
  onChange,
  query,
  onQueryChange,
  onOpenChange,
  options,
  loading,
  renderOption,
  renderValue,
  placeholder,
  emptyText,
  listLabel,
  error,
  hint,
  required,
}: {
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onOpenChange?: (open: boolean) => void;
  options: readonly T[];
  loading: boolean;
  renderOption: (option: T) => ReactNode;
  renderValue: (value: T) => ReactNode;
  placeholder: string;
  emptyText: string;
  listLabel: string;
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpenState] = useState(false);
  const [active, setActive] = useState(0);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const choose = (option: T) => {
    onChange(option);
    onQueryChange('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger-fg" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>

      {value ? (
        <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border border-line-strong bg-sunken px-3 py-1.5 text-sm">
          <span className="min-w-0">{renderValue(value)}</span>
          <button
            id={id}
            type="button"
            onClick={() => onChange(null)}
            className="rounded-sm p-0.5 text-ink-subtle hover:bg-surface hover:text-ink"
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[active] ? `${id}-opt-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className={cn(
              'h-9 w-full rounded-md border bg-surface px-3 text-sm placeholder:text-ink-subtle focus:border-focus focus:ring-2 focus:ring-focus/30 focus:outline-none',
              error ? 'border-danger-fg' : 'border-line-strong',
            )}
          />
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label={listLabel}
              className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-[0_8px_24px_-8px_rgb(28_25_23/0.3)]"
            >
              {loading ? (
                <li className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-subtle">
                  <Spinner size={12} /> Searching…
                </li>
              ) : options.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-ink-subtle">{emptyText}</li>
              ) : (
                options.map((option, i) => (
                  <li
                    key={option.id}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    // mousedown, not click: it fires before the input's blur closes the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'cursor-default px-3 py-1.5 text-sm',
                      i === active && 'bg-sunken',
                    )}
                  >
                    {renderOption(option)}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-danger-fg" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
