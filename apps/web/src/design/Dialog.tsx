import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './Button';
import { FormError } from './States';

/**
 * Modal dialog built on Radix: focus trapping, Escape to close, scroll lock and
 * aria wiring come from the primitive.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RadixDialog.Content
          // Capped to the viewport; tall forms scroll inside the body so the footer stays reachable.
          className={`fixed top-[max(16px,8vh)] left-1/2 z-50 flex max-h-[calc(100dvh-max(32px,16vh))] w-[calc(100vw-32px)] ${width} -translate-x-1/2 flex-col rounded-lg border border-line bg-surface shadow-[0_12px_40px_-12px_rgb(28_25_23/0.35)] focus:outline-none`}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold">{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-ink-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="-mr-1 rounded-sm p-1 text-ink-subtle hover:bg-sunken hover:text-ink"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    // Sticks to the bottom of the scrolling body, so Save is always visible.
    <div className="sticky -bottom-4 -mx-5 mt-5 -mb-4 flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
      {children}
    </div>
  );
}

/**
 * Confirmation for consequential actions. The title names the record and the
 * body states the consequence; the confirm button repeats the verb.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-3 text-sm text-ink-muted">{body}</div>
      {error ? (
        <div className="mt-3">
          <FormError error={error} />
        </div>
      ) : null}
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button variant={tone} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
