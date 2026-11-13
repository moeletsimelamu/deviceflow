import { describe, expect, it } from 'vitest';
import { changedFields } from './ActivityFeed';

describe('changedFields', () => {
  it('lists only fields whose values changed, ignoring bookkeeping fields', () => {
    const changes = changedFields({
      before: {
        model: 'Latitude 5440',
        serialNumber: 'ABC',
        version: 1,
        updatedAt: 'x',
        notes: null,
      },
      after: {
        model: 'Latitude 7450',
        serialNumber: 'ABC',
        version: 2,
        updatedAt: 'y',
        notes: 'Spare',
      },
    });
    expect(changes).toEqual([
      { field: 'model', from: 'Latitude 5440', to: 'Latitude 7450' },
      { field: 'notes', from: '—', to: 'Spare' },
    ]);
  });

  it('shows nested records by name', () => {
    const changes = changedFields({
      before: { customer: { id: '1', name: 'A School' } },
      after: { customer: { id: '2', name: 'B School' } },
    });
    expect(changes).toEqual([{ field: 'customer', from: 'A School', to: 'B School' }]);
  });

  it('returns nothing when either snapshot is missing', () => {
    expect(changedFields({ before: null, after: { a: 1 } })).toEqual([]);
  });
});
