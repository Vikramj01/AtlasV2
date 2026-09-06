/**
 * ConfidenceBadge — Report Honesty PRD Part A. Absence of the chip is
 * itself the signal, so 'high' and undefined must both render nothing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from './ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it('renders nothing for high confidence', () => {
    const { container } = render(<ConfidenceBadge confidence="high" />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when confidence is undefined (e.g. a v1-originated result)', () => {
    const { container } = render(<ConfidenceBadge confidence={undefined} />);
    expect(container.textContent).toBe('');
  });

  it('renders the "Needs confirmation" chip for confirm', () => {
    render(<ConfidenceBadge confidence="confirm" />);
    expect(screen.getByText('Needs confirmation')).not.toBeNull();
  });
});
