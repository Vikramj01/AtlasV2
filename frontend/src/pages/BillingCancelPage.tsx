import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Return page when the user cancels Stripe Checkout.
 * Stripe redirects here via cancel_url: /settings/billing/cancel
 *
 * Nothing changed — just return the user to /settings.
 */
export function BillingCancelPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/settings', { replace: true });
  }, [navigate]);

  return null;
}
