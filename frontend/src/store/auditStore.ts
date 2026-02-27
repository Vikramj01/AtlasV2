import { create } from 'zustand';
import type { AuditStatus, ReportJSON } from '@/types/audit';

interface CurrentAudit {
  id: string;
  status: AuditStatus;
  progress: number;
  error: string | null;
}

interface AuditStore {
  currentAudit: CurrentAudit | null;
  report: ReportJSON | null;
  setAudit: (audit: CurrentAudit) => void;
  updateAuditStatus: (status: AuditStatus, progress: number, error?: string | null) => void;
  setReport: (report: ReportJSON) => void;
  clearAudit: () => void;
}

export const useAuditStore = create<AuditStore>((set) => ({
  currentAudit: null,
  report: null,

  setAudit: (audit) => set({ currentAudit: audit, report: null }),

  updateAuditStatus: (status, progress, error = null) =>
    set((state) =>
      state.currentAudit
        ? { currentAudit: { ...state.currentAudit, status, progress, error } }
        : state
    ),

  setReport: (report) => set({ report }),

  clearAudit: () => set({ currentAudit: null, report: null }),
}));
