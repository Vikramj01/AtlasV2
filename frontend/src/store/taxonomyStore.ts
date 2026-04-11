import { create } from 'zustand';
import type { TaxonomyNode, NamingConvention } from '@/types/taxonomy';

interface TaxonomyState {
  tree: TaxonomyNode[];
  convention: NamingConvention | null;
  isLoadingTree: boolean;
  isLoadingConvention: boolean;

  setTree: (tree: TaxonomyNode[]) => void;
  setConvention: (convention: NamingConvention) => void;
  setLoadingTree: (loading: boolean) => void;
  setLoadingConvention: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  tree: [],
  convention: null,
  isLoadingTree: false,
  isLoadingConvention: false,
};

export const useTaxonomyStore = create<TaxonomyState>((set) => ({
  ...initialState,

  setTree: (tree) => set({ tree }),
  setConvention: (convention) => set({ convention }),
  setLoadingTree: (isLoadingTree) => set({ isLoadingTree }),
  setLoadingConvention: (isLoadingConvention) => set({ isLoadingConvention }),
  reset: () => set(initialState),
}));
