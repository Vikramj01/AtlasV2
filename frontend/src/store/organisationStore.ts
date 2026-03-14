import { create } from 'zustand';
import type { Organisation, ClientWithDetails, OrganisationMember } from '@/types/organisation';

interface OrganisationState {
  // Current workspace context
  currentOrg: Organisation | null;
  organisations: Organisation[];

  // Client list for the current org
  clients: ClientWithDetails[];

  // Members for the current org
  members: OrganisationMember[];

  // Loading / error
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentOrg: (org: Organisation | null) => void;
  setOrganisations: (orgs: Organisation[]) => void;
  setClients: (clients: ClientWithDetails[]) => void;
  setMembers: (members: OrganisationMember[]) => void;
  addClient: (client: ClientWithDetails) => void;
  removeClient: (clientId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  currentOrg: null,
  organisations: [],
  clients: [],
  members: [],
  isLoading: false,
  error: null,
};

export const useOrganisationStore = create<OrganisationState>((set) => ({
  ...initialState,

  setCurrentOrg: (org) => set({ currentOrg: org }),
  setOrganisations: (orgs) => set({ organisations: orgs }),
  setClients: (clients) => set({ clients }),
  setMembers: (members) => set({ members }),

  addClient: (client) =>
    set((state) => ({ clients: [client, ...state.clients] })),

  removeClient: (clientId) =>
    set((state) => ({ clients: state.clients.filter((c) => c.id !== clientId) })),

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
