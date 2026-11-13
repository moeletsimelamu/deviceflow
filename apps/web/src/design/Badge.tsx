import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const tones: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'bg-neutral-bg text-neutral-fg', dot: 'bg-neutral-fg/60' },
  success: { box: 'bg-success-bg text-success-fg', dot: 'bg-success-fg' },
  warning: { box: 'bg-warning-bg text-warning-fg', dot: 'bg-warning-fg' },
  danger: { box: 'bg-danger-bg text-danger-fg', dot: 'bg-danger-fg' },
  info: { box: 'bg-info-bg text-info-fg', dot: 'bg-info-fg' },
  accent: { box: 'bg-accent-soft text-accent', dot: 'bg-accent' },
};

/**
 * Status indicator. Always shows text, never colour alone, so it is readable
 * for colour-blind users and in greyscale print.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium whitespace-nowrap',
        tones[tone].box,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', tones[tone].dot)} aria-hidden="true" />}
      {children}
    </span>
  );
}
