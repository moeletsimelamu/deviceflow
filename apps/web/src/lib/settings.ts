import { useQuery } from '@tanstack/react-query';
import type { CompanySettings } from '@deviceflow/shared';
import { api } from './api';

/** Company currency and VAT rate (every staff role has settings:read). */
export function useCompanySettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ data: CompanySettings }>('/settings').then((r) => r.data),
  });
}

/** The company currency, or ZAR (decision D3) while settings are loading. */
export function useCurrency(): string {
  return useCompanySettings().data?.currency ?? 'ZAR';
}
