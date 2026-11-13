import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  formatVatRate,
  hasPermission,
  listUsersQuerySchema,
  loginSchema,
  updateUserSchema,
} from './index.js';

describe('loginSchema', () => {
  it('normalises the email address', () => {
    const parsed = loginSchema.parse({ email: '  Admin@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('admin@example.com');
  });

  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('createUserSchema', () => {
  const valid = {
    email: 'tech@example.com',
    fullName: 'Thandi Tech',
    role: 'TECHNICIAN',
    password: 'long-enough-password',
  };

  it('accepts a staff user', () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it('enforces the minimum password length', () => {
    expect(createUserSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('does not allow creating customer users directly', () => {
    expect(createUserSchema.safeParse({ ...valid, role: 'CUSTOMER' }).success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('requires at least one change', () => {
    expect(updateUserSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

describe('listUsersQuerySchema', () => {
  it('applies defaults', () => {
    const q = listUsersQuerySchema.parse({});
    expect(q).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: { field: 'fullName', direction: 'asc' },
    });
  });

  it('parses query-string values', () => {
    const q = listUsersQuerySchema.parse({ page: '2', isActive: 'false', sort: 'email:desc' });
    expect(q).toMatchObject({
      page: 2,
      isActive: false,
      sort: { field: 'email', direction: 'desc' },
    });
  });

  it('rejects sorting by a field that is not allow-listed', () => {
    expect(listUsersQuerySchema.safeParse({ sort: 'passwordHash:asc' }).success).toBe(false);
  });

  it('caps the page size', () => {
    expect(listUsersQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('grants user management only to administrators', () => {
    expect(hasPermission('ADMIN', 'users:manage')).toBe(true);
    expect(hasPermission('TECHNICIAN', 'users:manage')).toBe(false);
    expect(hasPermission('INVENTORY_MANAGER', 'users:manage')).toBe(false);
    expect(hasPermission('CUSTOMER', 'users:read')).toBe(false);
  });
});

describe('formatVatRate', () => {
  it('formats basis points', () => {
    expect(formatVatRate(1500)).toBe('15%');
    expect(formatVatRate(1525)).toBe('15.25%');
  });
});
