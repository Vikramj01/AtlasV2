import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { ChildAccountRow } from './ChildAccountRow';
import { RediscoverButton } from './RediscoverButton';
import type { ConnectionGroup, Platform, DiscoveredAccount } from '@/types/connections';

interface TestResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

interface ManagerConnectionCardProps {
  group: ConnectionGroup;
  clientId?: string;
  testResults: Record<string, TestResult>;
  testingId: string | null;
  actionLoadingId: string | null;
  onConnect: (connectionId: string, clientId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onTest: (connectionId: string) => void;
  onRediscover: (connectionId: string) => Promise<DiscoveredAccount[]>;
  onRemove: (connectionId: string) => void;
  onReauth: (platform: Platform, clientId?: string) => void;
}

export function ManagerConnectionCard({
  group,
  clientId,
  testResults,
  testingId,
  actionLoadingId,
  onConnect,
  onDisconnect,
  onTest,
  onRediscover,
  onRemove,
  onReauth,
}: ManagerConnectionCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [rediscovering, setRediscovering] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { manager, children } = group;

  async function handleRediscover() {
    setRediscovering(true);
    try {
      await onRediscover(manager.id);
    } finally {
      setRediscovering(false);
    }
  }

  const activeChildren  = children.filter((c) => c.status === 'active').length;
  const totalChildren   = children.length;

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
      {/* Manager header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#F9FAFB] border-b border-[#E5E7EB]">
        <button
          onClick={() => setExpanded((v: boolean) => !v)}
          className="text-[#6B7280] hover:text-[#1B2A4A] shrink-0"
          aria-label={expanded ? 'Collapse accounts' : 'Expand accounts'}
        >
          {expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#1B2A4A]">
              {manager.account_label ?? manager.account_id}
            </p>
            <ConnectionStatusBadge status={manager.status} />
          </div>
          <p className="text-xs text-[#9CA3AF]">
            Manager Account · {activeChildren}/{totalChildren} active
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <RediscoverButton
            connectionId={manager.id}
            isLoading={rediscovering}
            onRediscover={handleRediscover}
          />
          {confirmRemove ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600">Remove manager?</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRemove(false)}
                className="h-7 px-2 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => onRemove(manager.id)}
                disabled={actionLoadingId === manager.id}
                className="h-7 px-2 text-xs bg-red-600 text-white hover:bg-red-700 border-red-600"
              >
                Confirm
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              className="text-[#9CA3AF] hover:text-red-600 transition-colors"
              aria-label="Remove connection"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Child rows */}
      {expanded && (
        <div className="divide-y divide-[#F3F4F6]">
          {children.length === 0 ? (
            <p className="text-xs text-[#9CA3AF] px-4 py-4 text-center">
              No child accounts discovered yet. Click Re-scan to discover accounts.
            </p>
          ) : (
            children.map((child) => (
              <ChildAccountRow
                key={child.id}
                conn={child}
                clientId={clientId}
                testResult={testResults[child.id]}
                isTesting={testingId === child.id}
                isActioning={actionLoadingId === child.id}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onTest={onTest}
                onReauth={onReauth}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
