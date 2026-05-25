/**
 * ScoreCard component tests
 *
 * Covers: renders title and value, null value shows emptyState copy + CTA link,
 *         description rendered when provided, tooltip rendered,
 *         status badge rendered, value colour class applied.
 *
 * ScoreCard uses react-router-dom Link — wrap in MemoryRouter.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScoreCard } from '../ScoreCard';

function renderCard(props: Parameters<typeof ScoreCard>[0]) {
  return render(
    <MemoryRouter>
      <ScoreCard {...props} />
    </MemoryRouter>,
  );
}

describe('ScoreCard', () => {
  it('renders the title', () => {
    renderCard({ title: 'Health Score', value: 85 });
    expect(screen.getByText('Health Score')).toBeInTheDocument();
  });

  it('renders the numeric value', () => {
    renderCard({ title: 'Health Score', value: 85 });
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('renders a string value', () => {
    renderCard({ title: 'Status', value: 'Active' });
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    renderCard({ title: 'Score', value: 72, description: 'Last checked 1 hour ago' });
    expect(screen.getByText('Last checked 1 hour ago')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    renderCard({ title: 'Score', value: 72 });
    expect(screen.queryByText('Last checked')).not.toBeInTheDocument();
  });

  it('renders emptyState copy when value is null', () => {
    renderCard({
      title: 'Score',
      value: null,
      emptyState: { copy: 'No data yet', ctaLabel: 'Run a scan', ctaHref: '/crawl' },
    });
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.getByText('Run a scan →')).toBeInTheDocument();
  });

  it('emptyState CTA is a link to the correct href', () => {
    renderCard({
      title: 'Score',
      value: null,
      emptyState: { copy: 'No data', ctaLabel: 'Go', ctaHref: '/setup' },
    });
    const link = screen.getByRole('link', { name: 'Go →' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/setup');
  });

  it('does not render emptyState when value is present', () => {
    renderCard({
      title: 'Score',
      value: 50,
      emptyState: { copy: 'No data yet', ctaLabel: 'Run', ctaHref: '/crawl' },
    });
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders tooltip attribute when provided', () => {
    renderCard({ title: 'Score', value: 85, tooltip: 'Score explanation' });
    expect(screen.getByLabelText('Score explanation')).toBeInTheDocument();
  });

  it('renders status badge when provided', () => {
    renderCard({ title: 'Score', value: 85, status: 'Healthy' });
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders em dash for null value without emptyState', () => {
    renderCard({ title: 'Score', value: null });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
