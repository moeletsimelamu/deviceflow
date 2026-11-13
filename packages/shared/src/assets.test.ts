import { describe, expect, it } from 'vitest';
import {
  ASSET_STATUSES,
  ASSET_TRANSITIONS,
  canTransitionAsset,
  changeAssetStatusSchema,
  createAssetSchema,
  createCustomerSchema,
  normaliseSerial,
  updateCustomerSchema,
} from './index.js';

describe('asset lifecycle table', () => {
  it('only references real statuses and never allows staying in place', () => {
    for (const [from, targets] of Object.entries(ASSET_TRANSITIONS)) {
      for (const to of targets) {
        expect(ASSET_STATUSES).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it('makes DISPOSED final and reachable only from RETIRED', () => {
    expect(ASSET_TRANSITIONS.DISPOSED).toEqual([]);
    const into = ASSET_STATUSES.filter((s) => canTransitionAsset(s, 'DISPOSED'));
    expect(into).toEqual(['RETIRED']);
  });

  it('lets every status except DISPOSED reach RETIRED in one step or be RETIRED', () => {
    for (const s of ASSET_STATUSES.filter((s) => s !== 'DISPOSED' && s !== 'RETIRED')) {
      expect(canTransitionAsset(s, 'RETIRED')).toBe(true);
    }
  });
});

describe('serial numbers', () => {
  it('normalise to upper case with no whitespace', () => {
    expect(normaliseSerial('  5cg 1234\tx ')).toBe('5CG1234X');
  });

  it('turn blank input into null', () => {
    const parsed = createAssetSchema.parse({
      category: 'LAPTOP',
      manufacturer: 'HP',
      model: 'ProBook',
      serialNumber: '   ',
    });
    expect(parsed.serialNumber).toBeNull();
    expect(parsed.status).toBe('IN_STOCK');
    expect(parsed.condition).toBe('GOOD');
  });

  it('reject non-ASCII lookalike characters', () => {
    const result = createAssetSchema.safeParse({
      category: 'LAPTOP',
      manufacturer: 'HP',
      model: 'ProBook',
      serialNumber: 'АВС123', // Cyrillic letters that look like ABC
    });
    expect(result.success).toBe(false);
  });
});

describe('status change reasons', () => {
  it('are required for retiring and disposal only', () => {
    expect(changeAssetStatusSchema.safeParse({ status: 'RETIRED', version: 0 }).success).toBe(
      false,
    );
    expect(
      changeAssetStatusSchema.safeParse({ status: 'RETIRED', reason: 'Obsolete', version: 0 })
        .success,
    ).toBe(true);
    expect(changeAssetStatusSchema.safeParse({ status: 'IN_REPAIR', version: 0 }).success).toBe(
      true,
    );
  });
});

describe('customer schemas', () => {
  it('store blank optional fields as null and lower-case emails', () => {
    const parsed = createCustomerSchema.parse({
      type: 'INDIVIDUAL',
      name: ' Thandi Nkosi ',
      email: ' Thandi@Example.COM ',
      vatNumber: '',
    });
    expect(parsed).toMatchObject({
      name: 'Thandi Nkosi',
      email: 'thandi@example.com',
      vatNumber: null,
    });
  });

  it('require a change besides the version in an update', () => {
    expect(updateCustomerSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(updateCustomerSchema.safeParse({ city: null, version: 0 }).success).toBe(true);
  });
});
