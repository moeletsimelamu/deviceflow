import { describe, expect, it } from 'vitest';
import {
  createPartSchema,
  hasPermission,
  PART_USAGE_STATUSES,
  recordAdjustmentSchema,
  recordPurchaseSchema,
  stockStateOf,
  useRepairPartSchema,
} from './index.js';

describe('stock state', () => {
  it('is out at zero, low at or below the reorder level, otherwise in stock', () => {
    expect(stockStateOf(0, 0)).toBe('OUT');
    expect(stockStateOf(0, 5)).toBe('OUT');
    expect(stockStateOf(2, 2)).toBe('LOW');
    expect(stockStateOf(3, 2)).toBe('OK');
    expect(stockStateOf(1, 0)).toBe('OK');
  });
});

describe('inventory schemas', () => {
  it('normalises the SKU and rejects spaces', () => {
    const ok = createPartSchema.parse({
      sku: ' dell-bat/54.wh ',
      name: 'Battery',
      category: 'BATTERY',
      reorderLevel: 2,
    });
    expect(ok.sku).toBe('DELL-BAT/54.WH');
    expect(
      createPartSchema.safeParse({
        sku: 'two words',
        name: 'x',
        category: 'OTHER',
        reorderLevel: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts only whole positive quantities and whole-cent costs', () => {
    for (const quantity of [0, -1, 1.5, 10_001]) {
      expect(
        useRepairPartSchema.safeParse({ partId: '7a1c2a8e-3b7d-4c55-9a10-2f4e8d9b1c02', quantity })
          .success,
      ).toBe(false);
    }
    expect(recordPurchaseSchema.safeParse({ quantity: 1, unitCostCents: 10.5 }).success).toBe(
      false,
    );
    expect(recordPurchaseSchema.safeParse({ quantity: 1, unitCostCents: 0 }).success).toBe(true);
  });

  it('requires a reason for an adjustment', () => {
    expect(
      recordAdjustmentSchema.safeParse({ direction: 'OUT', quantity: 1, note: '  ' }).success,
    ).toBe(false);
  });

  it('allows parts only while a repair is under way', () => {
    expect([...PART_USAGE_STATUSES].sort()).toEqual([
      'AWAITING_PARTS',
      'IN_REPAIR',
      'QUALITY_CHECK',
    ]);
  });
});

describe('inventory permissions', () => {
  it('lets technicians read stock but only inventory managers and administrators change it', () => {
    expect(hasPermission('TECHNICIAN', 'inventory:read')).toBe(true);
    expect(hasPermission('TECHNICIAN', 'inventory:manage')).toBe(false);
    expect(hasPermission('INVENTORY_MANAGER', 'inventory:manage')).toBe(true);
    expect(hasPermission('INVENTORY_MANAGER', 'repairs:read')).toBe(true);
    expect(hasPermission('INVENTORY_MANAGER', 'repairs:read_details')).toBe(false);
    expect(hasPermission('INVENTORY_MANAGER', 'repairs:work')).toBe(false);
    expect(hasPermission('CUSTOMER', 'inventory:read')).toBe(false);
  });
});
