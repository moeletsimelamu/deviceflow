import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const controlBase =
  'rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-focus/30 focus:border-focus ' +
  'disabled:bg-sunken disabled:text-ink-subtle';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

/** Label, control, hint and error, wired together with ids for screen readers. */
function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
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
      {children}
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

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, required, className, id: idProp, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          controlBase,
          'w-full',
          'h-9',
          error ? 'border-danger-fg' : 'border-line-strong',
          className,
        )}
        {...props}
      />
    </FieldShell>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, required, options, className, id: idProp, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          controlBase,
          'w-full',
          'h-9 pr-8',
          error ? 'border-danger-fg' : 'border-line-strong',
          className,
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

/** Compact, label-less controls for filter bars (they carry an aria-label instead). */
export const FilterInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function FilterInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(controlBase, 'h-8 border-line-strong', className)}
        {...props}
      />
    );
  },
);

export const FilterSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & {
    options: ReadonlyArray<{ value: string; label: string }>;
  }
>(function FilterSelect({ className, options, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(controlBase, 'h-8 border-line-strong pr-8', className)}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, hint, error, required, className, id: idProp, ...props }, ref) {
    const generated = useId();
    const id = idProp ?? generated;
    return (
      <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
        <textarea
          ref={ref}
          id={id}
          required={required}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(
            controlBase,
            'w-full py-2 leading-5',
            error ? 'border-danger-fg' : 'border-line-strong',
            className,
          )}
          {...props}
        />
      </FieldShell>
    );
  },
);

export const CheckboxField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }
>(function CheckboxField({ label, hint, id: idProp, ...props }, ref) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <div className="flex items-start gap-2.5">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-4 rounded-sm border-line-strong accent-accent"
        {...props}
      />
      <div>
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-[13px] text-ink-subtle">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
});
