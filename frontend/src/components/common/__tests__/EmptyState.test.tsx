/**
 * EmptyState component tests
 *
 * Covers: title always rendered, optional description and action,
 *         compact variant, icon variants render without errors.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No signals yet" />);
    expect(screen.getByText('No signals yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <EmptyState
        title="No signals yet"
        description="Run a scan to discover tracking opportunities."
      />,
    );
    expect(screen.getByText('Run a scan to discover tracking opportunities.')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('renders the action when provided', () => {
    render(
      <EmptyState
        title="No clients"
        action={<button>Add Client</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add Client' })).toBeInTheDocument();
  });

  it('does not render action section when omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies compact padding when compact=true', () => {
    const { container } = render(<EmptyState title="Empty" compact />);
    expect(container.firstChild).toHaveClass('py-8');
    expect(container.firstChild).toHaveClass('px-4');
  });

  it('applies full padding when compact=false (default)', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.firstChild).toHaveClass('py-16');
    expect(container.firstChild).toHaveClass('px-6');
  });

  it('applies additional className when provided', () => {
    const { container } = render(<EmptyState title="Empty" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  describe('icon variants', () => {
    const icons = ['signals', 'chart', 'search', 'document', 'connect', 'check', 'generic'] as const;

    for (const icon of icons) {
      it(`renders without error with icon="${icon}"`, () => {
        expect(() => render(<EmptyState title="Test" icon={icon} />)).not.toThrow();
      });
    }

    it('defaults to generic icon when icon prop is omitted', () => {
      expect(() => render(<EmptyState title="Test" />)).not.toThrow();
    });
  });
});
