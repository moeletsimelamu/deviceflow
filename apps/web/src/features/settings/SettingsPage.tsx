import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES, type CompanySettings } from '@deviceflow/shared';
import { api } from '../../lib/api';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useCan } from '../auth/session';
import { PageHeader, Panel } from '../../design/Page';
import { SelectField, TextField } from '../../design/Field';
import { Button } from '../../design/Button';
import { ErrorState, FormError, Skeleton } from '../../design/States';

const SETTINGS_KEY = ['settings'] as const;

/** The form edits VAT as a percentage; the API stores basis points. */
const formSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name').max(120),
  currency: z.enum(SUPPORTED_CURRENCIES),
  vatPercent: z.coerce
    .number({ message: 'Enter a number' })
    .min(0, 'VAT cannot be negative')
    .max(100, 'VAT cannot exceed 100%')
    .refine((v) => Number.isInteger(Math.round(v * 100 * 1000) / 1000), 'Use at most two decimals'),
});

export function SettingsPage() {
  const canManage = useCan('settings:manage');
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<{ data: CompanySettings }>('/settings').then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: (input: object) =>
      api<{ data: CompanySettings }>('/settings', { method: 'PATCH', body: input }).then(
        (r) => r.data,
      ),
    onSuccess: (data) => queryClient.setQueryData(SETTINGS_KEY, data),
    onError: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });

  const form = useForm<z.input<typeof formSchema>, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
  });
  useEffect(() => {
    if (settings.data) {
      form.reset({
        companyName: settings.data.companyName,
        currency: settings.data.currency,
        vatPercent: settings.data.vatRateBasisPoints / 100,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const onSubmit = form.handleSubmit((values) => {
    if (!settings.data) return;
    save.mutate({
      companyName: values.companyName,
      currency: values.currency,
      vatRateBasisPoints: Math.round(values.vatPercent * 100),
      version: settings.data.version,
    });
  });

  const errors = form.formState.errors;
  const [watchedCurrency, watchedVat] = useWatch({
    control: form.control,
    name: ['currency', 'vatPercent'],
  });
  const currency = watchedCurrency ?? settings.data?.currency ?? 'ZAR';
  const vat = Number(watchedVat ?? 0);

  return (
    <>
      <PageHeader
        title="Company settings"
        description="Used on quotations, reports and customer-facing documents."
      />
      <Panel className="max-w-2xl">
        {settings.isPending ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-1/2" />
            <Skeleton className="h-9 w-1/3" />
          </div>
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <fieldset disabled={!canManage} className="space-y-5 p-6">
              <FormError error={save.error} />
              <TextField
                label="Company name"
                required
                error={errors.companyName?.message}
                {...form.register('companyName')}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Currency"
                  required
                  options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
                  {...form.register('currency')}
                />
                <TextField
                  label="VAT rate (%)"
                  required
                  inputMode="decimal"
                  error={errors.vatPercent?.message}
                  hint="Frozen on each quotation when it is issued."
                  {...form.register('vatPercent')}
                />
              </div>
              <p className="rounded-md bg-sunken px-3 py-2 text-[13px] text-ink-muted">
                Example: a {formatMoney(100_000, currency)} repair is quoted at{' '}
                <span className="tabular font-medium text-ink">
                  {Number.isFinite(vat)
                    ? formatMoney(Math.round(100_000 * (1 + vat / 100)), currency)
                    : '—'}
                </span>{' '}
                including VAT.
              </p>
            </fieldset>
            <div className="flex items-center justify-between gap-4 border-t border-line bg-canvas px-6 py-3">
              <span className="text-[12px] text-ink-subtle">
                Last changed {formatDateTime(settings.data.updatedAt)}
              </span>
              {canManage ? (
                <Button
                  type="submit"
                  variant="primary"
                  loading={save.isPending}
                  disabled={!form.formState.isDirty}
                >
                  Save settings
                </Button>
              ) : (
                <span className="text-[13px] text-ink-muted">
                  Only administrators can change these settings.
                </span>
              )}
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
