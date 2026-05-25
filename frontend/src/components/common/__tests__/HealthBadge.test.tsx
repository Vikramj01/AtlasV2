/**
 * HealthBadge component tests
 *
 * Covers: score thresholds (>=80 healthy/green, 60-79 warning/yellow, <60 error/red),
 *         score number rendered, badge label rendered.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthBadge } from '../HealthBadge';

describe('HealthBadge', () => {
  describe('score >= 80 (healthy)', () => {
    it('renders the score', () => {
      render(<HealthBadge score={85} />);
      expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('renders "Working" label', () => {
      render(<HealthBadge score={80} />);
      expect(screen.getByText('Working')).toBeInTheDocument();
    });

    it('applies green colour classes', () => {
      const { container } = render(<HealthBadge score={95} />);
      expect(container.firstChild).toHaveClass('bg-green-100');
      expect(container.firstChild).toHaveClass('text-green-700');
    });
  });

  describe('score 60-79 (warning)', () => {
    it('renders the score', () => {
      render(<HealthBadge score={72} />);
      expect(screen.getByText('72')).toBeInTheDocument();
    });

    it('renders "Needs Attention" label', () => {
      render(<HealthBadge score={65} />);
      expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    });

    it('applies yellow colour classes', () => {
      const { container } = render(<HealthBadge score={60} />);
      expect(container.firstChild).toHaveClass('bg-yellow-100');
      expect(container.firstChild).toHaveClass('text-yellow-700');
    });
  });

  describe('score < 60 (error)', () => {
    it('renders the score', () => {
      render(<HealthBadge score={42} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders "Not Working" label', () => {
      render(<HealthBadge score={30} />);
      expect(screen.getByText('Not Working')).toBeInTheDocument();
    });

    it('applies red colour classes', () => {
      const { container } = render(<HealthBadge score={0} />);
      expect(container.firstChild).toHaveClass('bg-red-100');
      expect(container.firstChild).toHaveClass('text-red-700');
    });
  });

  describe('boundary values', () => {
    it('score=79 is warning (yellow)', () => {
      render(<HealthBadge score={79} />);
      expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    });

    it('score=59 is error (red)', () => {
      render(<HealthBadge score={59} />);
      expect(screen.getByText('Not Working')).toBeInTheDocument();
    });
  });
});
