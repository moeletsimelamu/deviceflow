import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { findRepairRule, type Repair } from '@deviceflow/shared';
import { createQueryClient } from '../../lib/query-client';
import { MoveDialog, parseQuantity, parseRandToCents, QuoteEditor } from './RepairDialogs';

const repair: Repair = {
  id: '5d0c7a3e-1f2b-4c3d-9e8f-0a1b2c3d4e5f',
  reference: 'RJ-000042',
  status: 'IN_REPAIR',
  source: 'STAFF',
  faultDescription: 'Screen flickers',
  asset: {
    id: '6f1c2a8e-3b7d-4c55-9a10-2f4e8d9b1c01',
    assetTag: 'DF-2026-000042',
    category: 'LAPTOP',
    manufacturer: 'Dell',
    model: 'Latitude 5440',
    serialNumber: '7XK29P3',
  },
  customer: {
    id: '0b7e5d1a-9c2f-4f8e-8a3d-6c1b2e4f5a60',
    accountNumber: 'CU-000001',
    name: 'Parktown Primary',
    type: 'ORGANISATION',
    isActive: true,
  },
  contact: null,
  technician: { id: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', fullName: 'Sipho Dlamini' },
  submittedBy: { id: '2a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', fullName: 'Naledi Mokoena' },
  completionSummary: null,
  completedAt: null,
  closedAt: null,
  labourMinutes: 0,
  currentQuote: null,
  createdAt: '2026-11-12T08:00:00.000Z',
  updatedAt: '2026-11-12T08:00:00.000Z',
  version: 7,
};

function wrap(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('money input', () => {
  it('reads rand amounts into cents without floating-point error', () => {
    expect(parseRandToCents('1299,99')).toBe(129_999);
    expect(parseRandToCents('1 299.99')).toBe(129_999);
    expect(parseRandToCents('0.1')).toBe(10);
    expect(parseRandToCents('450')).toBe(45_000);
    expect(parseRandToCents('4.505')).toBeNull();
    expect(parseRandToCents('-1')).toBeNull();
    expect(parseRandToCents('')).toBeNull();
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('0')).toBeNull();
  });
});

describe('QuoteEditor', () => {
  // Types about 40 characters key by key; on a busy machine that can pass 5 s.
  it('shows live totals with VAT on the subtotal and saves cents with an idempotency key', async () => {
    const fetchMock = mockFetch({});
    const onClose = vi.fn();
    wrap(
      <QuoteEditor
        repair={repair}
        quote={null}
        vatRateBasisPoints={1500}
        currency="ZAR"
        onClose={onClose}
      />,
    );
    const [labour, part] = screen.getAllByRole('group');
    await userEvent.type(within(labour!).getByLabelText('Description'), 'Replace screen');
    await userEvent.clear(within(labour!).getByLabelText('Hours'));
    await userEvent.type(within(labour!).getByLabelText('Hours'), '1,5');
    await userEvent.type(within(labour!).getByLabelText('Unit price (R)'), '450');
    await userEvent.type(within(part!).getByLabelText('Description'), 'Screen assembly');
    await userEvent.type(within(part!).getByLabelText('Unit price (R)'), '1299,99');

    const totals = screen.getByLabelText('Quotation totals');
    // 675.00 + 1 299.99 = 1 974.99; VAT 15% = 296.25 (rounded half-up); total 2 271.24.
    expect(totals).toHaveTextContent(/1\s974,99/);
    expect(totals).toHaveTextContent(/296,25/);
    expect(totals).toHaveTextContent(/2\s271,24/);

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/repairs/${repair.id}/quotes`);
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      lines: [
        { kind: 'LABOUR', description: 'Replace screen', quantity: 1.5, unitPriceCents: 45_000 },
        { kind: 'PART', description: 'Screen assembly', quantity: 1, unitPriceCents: 129_999 },
      ],
      customerNote: null,
    });
  }, 15_000);

  it('does not save lines with a missing description or an invalid price', async () => {
    const fetchMock = mockFetch({});
    wrap(
      <QuoteEditor
        repair={repair}
        quote={null}
        vatRateBasisPoints={1500}
        currency="ZAR"
        onClose={() => {}}
      />,
    );
    const [labour] = screen.getAllByRole('group');
    await userEvent.type(within(labour!).getByLabelText('Unit price (R)'), '4.505');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText('Describe the line').length).toBeGreaterThan(0);
  });
});

describe('MoveDialog', () => {
  it('requires a reason to wait for parts and sends the version it was shown', async () => {
    const fetchMock = mockFetch({ ...repair, status: 'AWAITING_PARTS' });
    wrap(
      <MoveDialog
        repair={repair}
        rule={findRepairRule('IN_REPAIR', 'AWAITING_PARTS')!}
        onOpenChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Wait for parts' }));
    expect(screen.getByText('Give a reason for this change')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Reason/), 'Ordered a hinge from the supplier');
    await userEvent.click(screen.getByRole('button', { name: 'Wait for parts' }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/repairs/${repair.id}/transitions`);
    expect(JSON.parse(String(init.body))).toEqual({
      to: 'AWAITING_PARTS',
      note: 'Ordered a hinge from the supplier',
      completionSummary: null,
      version: 7,
    });
  });

  it('blocks quality check until labour has been recorded', () => {
    wrap(
      <MoveDialog
        repair={repair}
        rule={findRepairRule('IN_REPAIR', 'QUALITY_CHECK')!}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Record the time spent first');
    expect(screen.getByRole('button', { name: 'Send to quality check' })).toBeDisabled();
  });
});
