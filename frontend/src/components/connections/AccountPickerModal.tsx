import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckSquare, Square, X } from 'lucide-react';
import type { DiscoveredAccount, Platform } from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

interface AccountPickerModalProps {
  managerId: string;
  accounts: DiscoveredAccount[];
  clientId?: string;
  onConnect: (connectionId: string, clientId: string) => Promise<void>;
  onClose: () => void;
  actionLoadingId: string | null;
}

export function AccountPickerModal({
  accounts,
  clientId,
  onConnect,
  onClose,
  actionLoadingId,
}: AccountPickerModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const connectableAccounts = accounts.filter(
    (a) => a.existing_status !== 'active' && a.existing_connection_id,
  );

  function toggle(accountId: string) {
    setSelected((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  async function connectSelected() {
    if (!clientId) return;
    for (const account of connectableAccounts) {
      if (selected.has(account.account_id) && account.existing_connection_id) {
        await onConnect(account.existing_connection_id, clientId);
      }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-base font-semibold text-[#1B2A4A]">Discovered Accounts</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {accounts.length} account{accounts.length !== 1 ? 's' : ''} found. Select accounts to connect.
            </p>
          </div>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#1B2A4A]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Account list */}
        <div className="max-h-80 overflow-y-auto divide-y divide-[#F3F4F6]">
          {accounts.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">No accounts discovered.</p>
          ) : (
            accounts.map((account) => {
              const alreadyActive = account.existing_status === 'active';
              const isSelectable = !alreadyActive && !!account.existing_connection_id;
              const isChecked = selected.has(account.account_id);

              return (
                <div
                  key={account.account_id}
                  className={`flex items-center justify-between px-6 py-3 ${isSelectable ? 'cursor-pointer hover:bg-[#F9FAFB]' : 'opacity-60'}`}
                  onClick={() => isSelectable && toggle(account.account_id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isSelectable ? (
                      isChecked
                        ? <CheckSquare className="h-4 w-4 text-[#1B2A4A] shrink-0" />
                        : <Square className="h-4 w-4 text-[#9CA3AF] shrink-0" />
                    ) : (
                      <div className="h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1B2A4A] truncate">
                        {account.account_label || account.account_id}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">
                        {PLATFORM_LABELS[account.platform]} · {account.account_id}
                      </p>
                    </div>
                  </div>
                  {alreadyActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 shrink-0 ml-2">
                      Connected
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          <p className="text-xs text-[#9CA3AF]">
            {selected.size} selected
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {clientId ? 'Skip' : 'Close'}
            </Button>
            {clientId && (
              <Button
                size="sm"
                onClick={connectSelected}
                disabled={selected.size === 0 || actionLoadingId !== null}
                className="bg-[#1B2A4A] text-white hover:bg-[#243660]"
              >
                {actionLoadingId !== null ? 'Connecting…' : `Connect ${selected.size} account${selected.size !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
