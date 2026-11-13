import { z } from 'zod';

export const SUPPORTED_CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const;

/**
 * VAT is stored in basis points (1 bp = 0.01%) so it stays an integer:
 * 15% VAT = 1500. Money amounts elsewhere are integer cents.
 */
export const companySettingsSchema = z.object({
  companyName: z.string(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  vatRateBasisPoints: z.number().int(),
  updatedAt: z.string(),
  version: z.number().int(),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name').max(120).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
  version: z.number().int().min(0),
});
export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;

export function formatVatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}
