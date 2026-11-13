import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Asset } from '@deviceflow/shared';
import { createQueryClient } from '../../lib/query-client';
import { AssetStatusDialog } from './AssetDialogs';

const baseAsset: Asset = {
  id: '6f1c2a8e-3b7d-4c55-9a10-2f4e8d9b1c01',
  assetTag: 'DF-2026-000042',
  category: 'LAPTOP',
  manufacturer: 'Dell',
  model: 'Latitude 5440',
  serialNumber: '7XK29P3',
  condition: 'GOOD',
  status: 'ACTIVE',
  customer: {
    id: '0b7e5d1a-9c2f-4f8e-8a3d-6c1b2e4f5a60',
    accountNumber: 'CU-000001',
    name: 'Parktown Primary',
    type: 'ORGANISATION',
    isActive: true,
  },
  purchaseDate: null,
  warrantyExpiresOn: null,
  warrantyNotes: null,
  notes: null,
  createdBy: { id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', fullName: 'Naledi Mokoena' },
  createdAt: '2026-11-12T08:00:00.000Z',
  updatedAt: '2026-11-12T08:00:00.000Z',
  version: 3,
};

function renderDialog(asset: Asset) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AssetStatusDialog asset={asset} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('AssetStatusDialog', () => {
  it('offers only the transitions the lifecycle allows, leaving repairs to repair jobs', () => {
    renderDialog(baseAsset);
    const options = screen.getAllByRole('radio').map((r) => r.getAttribute('value'));
    expect(options).toEqual(['IN_STOCK', 'RETIRED']);
    expect(screen.getByText(/book it in from its Repairs panel/)).toBeInTheDocument();
  });

  it('requires a reason before retiring, then sends the version it was shown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ...baseAsset, status: 'RETIRED', version: 4 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderDialog(baseAsset);

    await userEvent.click(screen.getByRole('radio', { name: /Retired/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark as retired' }));
    expect(await screen.findByText('Give a reason for this change')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Reason/), 'Board failure, not economical');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as retired' }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/assets/${baseAsset.id}/status`);
    expect(JSON.parse(String(init.body))).toEqual({
      status: 'RETIRED',
      reason: 'Board failure, not economical',
      version: 3,
    });
  });

  it('explains that a disposed asset cannot change', () => {
    renderDialog({ ...baseAsset, status: 'DISPOSED' });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/Disposed is a final status/)).toBeInTheDocument();
  });

  it('blocks making an unassigned asset active', async () => {
    renderDialog({ ...baseAsset, status: 'IN_STOCK', customer: null });
    await userEvent.click(screen.getByRole('radio', { name: /Active/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Assign this asset to a customer');
    expect(screen.getByRole('button', { name: 'Mark as active' })).toBeDisabled();
  });
});
