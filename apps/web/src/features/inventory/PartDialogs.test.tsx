import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { Part, Repair } from '@deviceflow/shared';
import { createQueryClient } from '../../lib/query-client';
import { UsePartForm } from '../repairs/RepairPartsPanel';
import { AdjustForm, parseUnits, ReceiveForm } from './PartDialogs';

const part: Part = {
  id: '7a1c2a8e-3b7d-4c55-9a10-2f4e8d9b1c02',
  sku: 'DELL-BAT-54WH',
  name: 'Dell 54 Wh battery',
  category: 'BATTERY',
  description: null,
  location: 'A1-01',
  quantityOnHand: 3,
  reorderLevel: 2,
  stockState: 'OK',
  averageCostCents: 78_000,
  stockValueCents: 234_000,
  isActive: true,
  createdAt: '2026-11-12T08:00:00.000Z',
  updatedAt: '2026-11-12T08:00:00.000Z',
  version: 0,
};

function wrap(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Answers GET /settings with ZAR and records every other request. */
function mockApi() {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: url.endsWith('/settings') ? { currency: 'ZAR', vatRateBasisPoints: 1500 } : {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const writes = () =>
    fetchMock.mock.calls
      .map((c) => c as unknown as [string, RequestInit])
      .filter(([, init]) => init?.method === 'POST');
  return { writes };
}

afterEach(() => vi.unstubAllGlobals());

describe('parseUnits', () => {
  it('accepts whole units from 1 to 10 000 only', () => {
    expect(parseUnits('3')).toBe(3);
    expect(parseUnits(' 10000 ')).toBe(10_000);
    for (const bad of ['0', '1.5', '-2', '10001', '', 'two']) expect(parseUnits(bad)).toBeNull();
  });
});

describe('AdjustForm', () => {
  it('needs a reason and will not remove more than is in stock', async () => {
    const { writes } = mockApi();
    wrap(<AdjustForm part={part} onClose={() => {}} />);
    await userEvent.clear(screen.getByLabelText(/Units/));
    await userEvent.type(screen.getByLabelText(/Units/), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Remove from stock' }));
    expect(screen.getByText('Only 3 in stock')).toBeInTheDocument();
    expect(screen.getByText('Give a reason for the adjustment')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('sends a write-off with its reason and an idempotency key', async () => {
    const { writes } = mockApi();
    wrap(<AdjustForm part={part} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Reason/), 'Swollen in storage');
    expect(screen.getByText(/Stock goes from 3 to/)).toHaveTextContent('3 to 2');
    await userEvent.click(screen.getByRole('button', { name: 'Remove from stock' }));
    const [url, init] = writes()[0]!;
    expect(url).toBe(`/api/v1/inventory/parts/${part.id}/adjustments`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      direction: 'OUT',
      quantity: 1,
      note: 'Swollen in storage',
    });
  });
});

describe('ReceiveForm', () => {
  it('reads the cost in rand and shows the new stock level', async () => {
    const { writes } = mockApi();
    wrap(<ReceiveForm part={part} onClose={() => {}} />);
    await userEvent.clear(screen.getByLabelText(/Units received/));
    await userEvent.type(screen.getByLabelText(/Units received/), '2');
    await userEvent.type(screen.getByLabelText(/Cost per unit/), '780,50');
    await userEvent.type(screen.getByLabelText(/Supplier/), 'Rectron');
    expect(screen.getByText(/Stock goes from/)).toHaveTextContent('3 to 5');
    await userEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    const [url, init] = writes()[0]!;
    expect(url).toBe(`/api/v1/inventory/parts/${part.id}/purchases`);
    expect(JSON.parse(String(init.body))).toEqual({
      quantity: 2,
      unitCostCents: 78_050,
      supplier: 'Rectron',
      reference: null,
      note: null,
    });
  });
});

describe('UsePartForm', () => {
  it('asks for a part before taking anything out of stock', async () => {
    const { writes } = mockApi();
    wrap(
      <UsePartForm repair={{ id: 'r1', reference: 'RJ-000003' } as Repair} onClose={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use part' }));
    expect(screen.getByText('Choose a part')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
});
