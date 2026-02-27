/**
 * Enhanced Quick Destinations Store with favorites integration and recent destinations
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type QuickDestinationType = "home" | "work" | "custom" | "recent";

export interface QuickDestination {
  id: string;
  label: string;
  coords: { lat: number; lon: number };
  type: QuickDestinationType;
  icon?: string;
  color?: string;
  timestamp?: number; // For recent destinations
}

interface EnhancedQuickDestinationsStore {
  // Core destinations (home/work)
  home: QuickDestination | null;
  work: QuickDestination | null;
  
  // Custom user destinations
  customDestinations: QuickDestination[];
  
  // Recent destinations (last used)
  recentDestinations: QuickDestination[];
  
  // Maximum number of recent destinations to keep
  maxRecentDestinations: number;
  
  // Actions
  setHome: (dest: QuickDestination | null) => void;
  setWork: (dest: QuickDestination | null) => void;
  addCustomDestination: (dest: QuickDestination) => void;
  updateCustomDestination: (id: string, updates: Partial<QuickDestination>) => void;
  deleteCustomDestination: (id: string) => void;
  addRecentDestination: (dest: QuickDestination) => void;
  clearRecentDestinations: () => void;
  setMaxRecentDestinations: (max: number) => void;
  
  // Helper actions
  getAllDestinations: () => QuickDestination[];
  getDestinationById: (id: string) => QuickDestination | undefined;
  isDestinationExists: (coords: { lat: number; lon: number }) => boolean;
}

const STORAGE_KEY = "trashroute-enhanced-quick-destinations";

export const useEnhancedQuickDestinationsStore = create<EnhancedQuickDestinationsStore>()(
  persist(
    (set, get) => ({
      home: null,
      work: null,
      customDestinations: [],
      recentDestinations: [],
      maxRecentDestinations: 5,

      setHome: (home) => set({ home }),
      
      setWork: (work) => set({ work }),
      
      addCustomDestination: (dest) => {
        set((state) => ({
          customDestinations: [...state.customDestinations, dest]
        }));
      },
      
      updateCustomDestination: (id, updates) => {
        set((state) => ({
          customDestinations: state.customDestinations.map(dest =>
            dest.id === id ? { ...dest, ...updates } : dest
          )
        }));
      },
      
      deleteCustomDestination: (id) => {
        set((state) => ({
          customDestinations: state.customDestinations.filter(dest => dest.id !== id)
        }));
      },
      
      addRecentDestination: (dest) => {
        set((state) => {
          const recentDest = { ...dest, type: "recent" as const, timestamp: Date.now() };
          
          // Remove if already exists (by coordinates)
          let filteredRecent = state.recentDestinations.filter(
            recent => !(recent.coords.lat === dest.coords.lat && recent.coords.lon === dest.coords.lon)
          );
          
          // Add new destination at the beginning
          filteredRecent = [recentDest, ...filteredRecent];
          
          // Keep only max recent destinations
          filteredRecent = filteredRecent.slice(0, state.maxRecentDestinations);
          
          return { recentDestinations: filteredRecent };
        });
      },
      
      clearRecentDestinations: () => set({ recentDestinations: [] }),
      
      setMaxRecentDestinations: (max) => set({ maxRecentDestinations: max }),
      
      getAllDestinations: () => {
        const state = get();
        const allDests: QuickDestination[] = [];
        
        if (state.home) allDests.push(state.home);
        if (state.work) allDests.push(state.work);
        allDests.push(...state.customDestinations);
        allDests.push(...state.recentDestinations);
        
        return allDests;
      },
      
      getDestinationById: (id) => {
        const state = get();
        
        if (state.home?.id === id) return state.home;
        if (state.work?.id === id) return state.work;
        
        const customDest = state.customDestinations.find(dest => dest.id === id);
        if (customDest) return customDest;
        
        const recentDest = state.recentDestinations.find(dest => dest.id === id);
        return recentDest;
      },
      
      isDestinationExists: (coords) => {
        const state = get();
        const allDests = state.getAllDestinations();
        
        return allDests.some(dest => 
          dest.coords && 
          Math.abs(dest.coords.lat - coords.lat) < 0.0001 && 
          Math.abs(dest.coords.lon - coords.lon) < 0.0001
        );
      }
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        home: state.home,
        work: state.work,
        customDestinations: state.customDestinations,
        recentDestinations: state.recentDestinations,
        maxRecentDestinations: state.maxRecentDestinations
      })
    }
  )
);

// Helper hooks for common operations
export function useQuickDestinations() {
  const store = useEnhancedQuickDestinationsStore();
  
  return {
    // Core destinations
    home: store.home,
    work: store.work,
    custom: store.customDestinations,
    recent: store.recentDestinations,
    
    // Actions
    setHome: store.setHome,
    setWork: store.setWork,
    addCustom: store.addCustomDestination,
    updateCustom: store.updateCustomDestination,
    deleteCustom: store.deleteCustomDestination,
    addRecent: store.addRecentDestination,
    clearRecent: store.clearRecentDestinations,
    
    // Helpers
    allDestinations: store.getAllDestinations(),
    getById: store.getDestinationById,
    exists: store.isDestinationExists
  };
}