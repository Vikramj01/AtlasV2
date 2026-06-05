import { create } from 'zustand';
import type { SlackDestination } from '@/lib/api/slackApi';

interface SlackState {
  destinations: SlackDestination[];
  isLoading: boolean;
  setDestinations: (destinations: SlackDestination[]) => void;
  addDestination: (d: SlackDestination) => void;
  updateDestination: (d: SlackDestination) => void;
  removeDestination: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useSlackStore = create<SlackState>((set) => ({
  destinations: [],
  isLoading: false,

  setDestinations: (destinations) => set({ destinations }),
  addDestination: (d) => set((s) => ({ destinations: [d, ...s.destinations] })),
  updateDestination: (d) =>
    set((s) => ({ destinations: s.destinations.map((x) => (x.id === d.id ? d : x)) })),
  removeDestination: (id) =>
    set((s) => ({ destinations: s.destinations.filter((x) => x.id !== id) })),
  setLoading: (isLoading) => set({ isLoading }),
}));
