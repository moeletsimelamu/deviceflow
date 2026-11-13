import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@deviceflow/shared';
import { Button } from './Button';

/** "1–20 of 134" with previous / next buttons, shown under a table. */
export function Pagination({
  meta,
  onPage,
}: {
  meta: PageMeta | undefined;
  onPage: (page: number) => void;
}) {
  if (!meta || meta.total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-muted">
      <span className="tabular">
        {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of{' '}
        {meta.total}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          size="sm"
          aria-label="Next page"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
