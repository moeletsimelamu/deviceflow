import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { ErrorState, FormError } from './States';

describe('error messages', () => {
  it('shows the message and reference of an API error', () => {
    render(
      <ErrorState
        error={new ApiError(404, 'NOT_FOUND', 'Repair job not found', [], 'req-123')}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Repair job not found');
    expect(screen.getByText('Reference: req-123')).toBeInTheDocument();
  });

  it('does not show the technical message of a bug in the page', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'status')");
    render(
      <>
        <ErrorState error={bug} />
        <FormError error={bug} />
      </>,
    );
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).not.toHaveTextContent('Cannot read properties');
      expect(alert).toHaveTextContent('Something went wrong on this page');
    }
  });
});
