/**
 * StatusBanner component tests
 *
 * Covers: all three status variants render with correct headline,
 *         summary text rendered, correct colour classes applied.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBanner } from '../StatusBanner';

describe('StatusBanner', () => {
  describe('healthy status', () => {
    it('renders the correct headline', () => {
      render(<StatusBanner status="healthy" summary="All signals working." />);
      expect(screen.getByText('Your Conversion Signals Are Healthy')).toBeInTheDocument();
    });

    it('applies green colour classes', () => {
      const { container } = render(<StatusBanner status="healthy" summary="All good." />);
      expect(container.firstChild).toHaveClass('bg-green-50');
      expect(container.firstChild).toHaveClass('border-green-200');
    });
  });

  describe('partially_broken status', () => {
    it('renders the correct headline', () => {
      render(<StatusBanner status="partially_broken" summary="Some signals need attention." />);
      expect(screen.getByText('Your Signals Are Partially Broken')).toBeInTheDocument();
    });

    it('applies yellow colour classes', () => {
      const { container } = render(
        <StatusBanner status="partially_broken" summary="Check signals." />,
      );
      expect(container.firstChild).toHaveClass('bg-yellow-50');
      expect(container.firstChild).toHaveClass('border-yellow-200');
    });
  });

  describe('critical status', () => {
    it('renders the correct headline', () => {
      render(<StatusBanner status="critical" summary="Signals are down." />);
      expect(screen.getByText('Critical Attribution Issues Detected')).toBeInTheDocument();
    });

    it('applies red colour classes', () => {
      const { container } = render(<StatusBanner status="critical" summary="Critical issue." />);
      expect(container.firstChild).toHaveClass('bg-red-50');
      expect(container.firstChild).toHaveClass('border-red-200');
    });
  });

  describe('summary text', () => {
    it('renders the summary message', () => {
      const summary = 'Your tracking score is above 80 — campaigns can optimise effectively.';
      render(<StatusBanner status="healthy" summary={summary} />);
      expect(screen.getByText(summary)).toBeInTheDocument();
    });
  });
});
