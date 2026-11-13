import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketFor,
  daysInRange,
  defaultReportRange,
  hasPermission,
  MAX_REPORT_DAYS,
  reportQuerySchema,
} from './index.js';

describe('report dates', () => {
  it('counts inclusive calendar days across month and leap-year boundaries', () => {
    expect(daysInRange('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInRange('2026-10-31', '2026-10-31')).toBe(1);
    expect(daysInRange('2028-02-28', '2028-03-01')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('defaults to the 30 days ending today', () => {
    expect(defaultReportRange('2026-11-13')).toEqual({ from: '2026-10-15', to: '2026-11-13' });
  });

  it('chooses daily, weekly or monthly buckets by length', () => {
    expect([bucketFor(1), bucketFor(31), bucketFor(32), bucketFor(183), bucketFor(184)]).toEqual([
      'day',
      'day',
      'week',
      'week',
      'month',
    ]);
  });

  it('refuses reversed and over-long ranges', () => {
    expect(reportQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(
      reportQuerySchema.safeParse({
        from: '2024-01-01',
        to: addDays('2024-01-01', MAX_REPORT_DAYS),
      }).success,
    ).toBe(false);
    expect(
      reportQuerySchema.safeParse({
        from: '2024-01-01',
        to: addDays('2024-01-01', MAX_REPORT_DAYS - 1),
      }).success,
    ).toBe(true);
    expect(reportQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('report permissions', () => {
  it('keeps revenue reports to administrators', () => {
    expect(hasPermission('ADMIN', 'reports:operations')).toBe(true);
    expect(hasPermission('INVENTORY_MANAGER', 'reports:operations')).toBe(false);
    expect(hasPermission('INVENTORY_MANAGER', 'reports:inventory')).toBe(true);
    expect(hasPermission('TECHNICIAN', 'reports:operations')).toBe(false);
    expect(hasPermission('TECHNICIAN', 'reports:inventory')).toBe(false);
  });
});
