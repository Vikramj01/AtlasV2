/**
 * SeverityBadge component tests
 *
 * Covers: all four severity levels render with correct label,
 *         correct colour classes applied, size variants (sm/md).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeverityBadge } from '../SeverityBadge';

describe('SeverityBadge', () => {
  describe('severity labels', () => {
    it('renders "Critical" for critical severity', () => {
      render(<SeverityBadge severity="critical" />);
      expect(screen.getByText('Critical')).toBeInTheDocument();
    });

    it('renders "High" for high severity', () => {
      render(<SeverityBadge severity="high" />);
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    it('renders "Medium" for medium severity', () => {
      render(<SeverityBadge severity="medium" />);
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    it('renders "Low" for low severity', () => {
      render(<SeverityBadge severity="low" />);
      expect(screen.getByText('Low')).toBeInTheDocument();
    });
  });

  describe('colour classes', () => {
    it('critical: red background and text', () => {
      const { container } = render(<SeverityBadge severity="critical" />);
      expect(container.firstChild).toHaveClass('bg-red-100');
      expect(container.firstChild).toHaveClass('text-red-700');
    });

    it('high: orange background and text', () => {
      const { container } = render(<SeverityBadge severity="high" />);
      expect(container.firstChild).toHaveClass('bg-orange-100');
      expect(container.firstChild).toHaveClass('text-orange-700');
    });

    it('medium: yellow background and text', () => {
      const { container } = render(<SeverityBadge severity="medium" />);
      expect(container.firstChild).toHaveClass('bg-yellow-100');
      expect(container.firstChild).toHaveClass('text-yellow-700');
    });

    it('low: gray background and text', () => {
      const { container } = render(<SeverityBadge severity="low" />);
      expect(container.firstChild).toHaveClass('bg-gray-100');
      expect(container.firstChild).toHaveClass('text-gray-600');
    });
  });

  describe('size variants', () => {
    it('defaults to md size (larger padding)', () => {
      const { container } = render(<SeverityBadge severity="high" />);
      expect(container.firstChild).toHaveClass('px-2.5');
      expect(container.firstChild).toHaveClass('py-1');
    });

    it('sm size applies smaller padding', () => {
      const { container } = render(<SeverityBadge severity="high" size="sm" />);
      expect(container.firstChild).toHaveClass('px-2');
      expect(container.firstChild).toHaveClass('py-0.5');
    });
  });

  describe('dot indicator', () => {
    it('renders a coloured dot for critical', () => {
      const { container } = render(<SeverityBadge severity="critical" />);
      const dot = container.querySelector('span > span');
      expect(dot).toHaveClass('bg-red-500');
    });

    it('renders a coloured dot for low', () => {
      const { container } = render(<SeverityBadge severity="low" />);
      const dot = container.querySelector('span > span');
      expect(dot).toHaveClass('bg-gray-400');
    });
  });
});
