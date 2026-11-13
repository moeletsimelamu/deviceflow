import { describe, expect, it } from 'vitest';
import { ROLES } from '@deviceflow/shared';
import { Role } from '../../src/generated/prisma/enums.js';

describe('shared roles', () => {
  it('match the Role enum in the database schema', () => {
    expect([...ROLES].sort()).toEqual(Object.values(Role).sort());
  });
});
