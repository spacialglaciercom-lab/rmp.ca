import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface HelpStore {
  // Track if user has seen the tutorial
  hasSeenTutorial: boolean;
  // Track if user has dismissed the help prompt
  hasDismissedHelpPrompt: boolean;
  // Track which help sections have been viewed
  viewedHelpSections: string[];
  // Track when help was last accessed
  lastHelpAccess: number | null;
  
  // Actions
  setHasSeenTutorial: (seen: boolean) => void;
  setHasDismissedHelpPrompt: (dismissed: boolean) => void;
  addViewedHelpSection: (sectionId: string) => void;
  setLastHelpAccess: (timestamp: number) => void;
  resetHelpState: () => void;
}

export const useHelpStore = create<HelpStore>()(
  persist(
    (set) => ({
      hasSeenTutorial: false,
      hasDismissedHelpPrompt: false,
      viewedHelpSections: [],
      lastHelpAccess: null,

      setHasSeenTutorial: (seen) => set({ hasSeenTutorial: seen }),
      setHasDismissedHelpPrompt: (dismissed) => set({ hasDismissedHelpPrompt: dismissed }),
      addViewedHelpSection: (sectionId) => set((state) => ({
        viewedHelpSections: state.viewedHelpSections.includes(sectionId) 
          ? state.viewedHelpSections 
          : [...state.viewedHelpSections, sectionId]
      })),
      setLastHelpAccess: (timestamp) => set({ lastHelpAccess: timestamp }),
      resetHelpState: () => set({
        hasSeenTutorial: false,
        hasDismissedHelpPrompt: false,
        viewedHelpSections: [],
        lastHelpAccess: null
      })
    }),
    {
      name: 'help-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasSeenTutorial: state.hasSeenTutorial,
        hasDismissedHelpPrompt: state.hasDismissedHelpPrompt,
        viewedHelpSections: state.viewedHelpSections,
        lastHelpAccess: state.lastHelpAccess
      })
    }
  )
);