import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarList, ChartCard, ColumnChart, DataTable, niceTicks } from './charts';
import { formatDuration, presetRange } from './ReportsPage';

describe('niceTicks', () => {
  it('rounds the axis up to clean steps', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(7)).toEqual([0, 5, 10]);
    expect(niceTicks(10)).toEqual([0, 5, 10]);
    expect(niceTicks(230_000)).toEqual([0, 100_000, 200_000, 300_000]);
  });
});

describe('presetRange', () => {
  it('works out each preset from today', () => {
    expect(presetRange('7', '2026-11-13')).toEqual({ from: '2026-11-07', to: '2026-11-13' });
    expect(presetRange('30', '2026-11-13')).toEqual({ from: '2026-10-15', to: '2026-11-13' });
    expect(presetRange('month', '2026-11-13')).toEqual({ from: '2026-11-01', to: '2026-11-13' });
    expect(presetRange('last-month', '2026-11-13')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(presetRange('last-month', '2026-01-05')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('year', '2026-11-13')).toEqual({ from: '2026-01-01', to: '2026-11-13' });
  });
});

describe('formatDuration', () => {
  it('shows hours under two days and days after', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(42.5)).toBe('42,5 h');
    expect(formatDuration(72)).toBe('3 days');
  });
});

describe('ColumnChart', () => {
  const points = [
    { key: 'a', label: '1 Oct', title: '1 Oct 2026', values: [3, 1] },
    { key: 'b', label: '2 Oct', title: '2 Oct 2026', values: [0, 2] },
  ];
  const series = [
    { name: 'Booked in', color: 'blue' },
    { name: 'Completed', color: 'orange' },
  ];

  it('names every period and value for screen readers and shows a legend for two series', () => {
    render(<ColumnChart label="Jobs" points={points} series={series} format={String} />);
    expect(
      screen.getByRole('listitem', { name: '1 Oct 2026: Booked in 3, Completed 1' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Legend')).toHaveTextContent('Booked inCompleted');
  });

  it('shows the same details on keyboard focus as on hover', () => {
    render(<ColumnChart label="Jobs" points={points} series={series} format={String} />);
    const second = screen.getByRole('listitem', { name: /2 Oct 2026/ });
    fireEvent.focus(second);
    expect(screen.getByRole('status')).toHaveTextContent('2 Oct 2026Booked in0Completed2');
    fireEvent.blur(second);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('has no legend box for a single series', () => {
    render(<ColumnChart label="Revenue" points={points} series={[series[0]!]} format={String} />);
    expect(screen.queryByLabelText('Legend')).toBeNull();
  });
});

describe('ChartCard', () => {
  it('switches between the chart and its table view', async () => {
    render(
      <ChartCard
        title="Open jobs by status"
        chart={<BarList label="Open jobs" rows={[{ key: 'x', label: 'In repair', value: 4 }]} />}
        tableView={
          <DataTable
            columns={[{ label: 'Status' }, { label: 'Jobs', numeric: true }]}
            rows={[{ key: 'x', cells: ['In repair', 4] }]}
          />
        }
      />,
    );
    expect(screen.getByLabelText('Open jobs')).toHaveTextContent('In repair4');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getByRole('table')).toHaveTextContent('StatusJobsIn repair4');
    expect(screen.getByRole('button', { name: 'Show chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
