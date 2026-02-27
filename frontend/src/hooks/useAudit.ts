import { useState, useEffect, useRef } from 'react';
import { auditApi } from '@/lib/api/auditApi';
import { useAuditStore } from '@/store/auditStore';
import type { StartAuditInput } from '@/types/audit';

// ─── Start audit ──────────────────────────────────────────────────────────────

export function useAudit() {
  const setAudit = useAuditStore((s) => s.setAudit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAudit = async (input: StartAuditInput): Promise<string | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await auditApi.start(input);
      setAudit({ id: res.audit_id, status: 'queued', progress: 0, error: null });
      return res.audit_id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start audit');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { startAudit, loading, error };
}

// ─── Poll audit status ────────────────────────────────────────────────────────

export function useAuditStatus(auditId: string | undefined) {
  const updateAuditStatus = useAuditStore((s) => s.updateAuditStatus);
  const currentAudit = useAuditStore((s) => s.currentAudit);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDone = currentAudit?.status === 'completed' || currentAudit?.status === 'failed';

  useEffect(() => {
    if (!auditId || isDone) return;

    const poll = async () => {
      try {
        const res = await auditApi.getStatus(auditId);
        updateAuditStatus(res.status, res.progress, res.error);
        if (res.status === 'completed' || res.status === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        // Network hiccup — keep polling
      }
    };

    poll(); // immediate first call
    intervalRef.current = setInterval(poll, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [auditId, isDone, updateAuditStatus]);

  return { status: currentAudit?.status, progress: currentAudit?.progress ?? 0, error: currentAudit?.error };
}
