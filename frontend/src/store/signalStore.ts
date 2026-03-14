import { create } from 'zustand';
import type { Signal, SignalPack, SignalPackWithSignals } from '@/types/signal';

interface SignalState {
  signals: Signal[];
  packs: SignalPack[];
  currentPack: SignalPackWithSignals | null;

  setSignals: (signals: Signal[]) => void;
  setPacks: (packs: SignalPack[]) => void;
  setCurrentPack: (pack: SignalPackWithSignals | null) => void;

  addSignal: (signal: Signal) => void;
  removeSignal: (signalId: string) => void;
  updateSignal: (signal: Signal) => void;

  addPack: (pack: SignalPack) => void;
  removePack: (packId: string) => void;
  updatePack: (pack: SignalPack) => void;

  reset: () => void;
}

const initialState = {
  signals: [],
  packs: [],
  currentPack: null,
};

export const useSignalStore = create<SignalState>((set) => ({
  ...initialState,

  setSignals: (signals) => set({ signals }),
  setPacks: (packs) => set({ packs }),
  setCurrentPack: (currentPack) => set({ currentPack }),

  addSignal: (signal) => set((s) => ({ signals: [signal, ...s.signals] })),
  removeSignal: (id) => set((s) => ({ signals: s.signals.filter((sig) => sig.id !== id) })),
  updateSignal: (signal) =>
    set((s) => ({ signals: s.signals.map((sig) => (sig.id === signal.id ? signal : sig)) })),

  addPack: (pack) => set((s) => ({ packs: [pack, ...s.packs] })),
  removePack: (id) => set((s) => ({ packs: s.packs.filter((p) => p.id !== id) })),
  updatePack: (pack) =>
    set((s) => ({ packs: s.packs.map((p) => (p.id === pack.id ? pack : p)) })),

  reset: () => set(initialState),
}));
