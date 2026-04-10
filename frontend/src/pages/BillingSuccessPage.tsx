import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBillingStore } from '@/store/billingStore';

/**
 * Return page after a successful Stripe Checkout.
 * Stripe redirects here via success_url: /settings/billing/success
 *
 * Refreshes billing status then sends the user back to /settings.
 */
export function BillingSuccessPage() {
  const navigate = useNavigate();
  const fetchStatus = useBillingStore((s) => s.fetchStatus);

  useEffect(() => {
    fetchStatus().then(() => {
      navigate('/settings', { replace: true });
    });
  }, [fetchStatus, navigate]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1B2A4A]/20 border-t-[#1B2A4A]" />
      <p className="text-sm text-muted-foreground">Activating your plan…</p>
    </div>
  );
}
