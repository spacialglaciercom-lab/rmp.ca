import { create } from "zustand";

export type MapSidebarSubScreen =
  | "places"
  | "markers"
  | "resources"
  | "navigation"
  | "recording"
  | "configure"
  | null;

interface MapSidebarStore {
  isOpen: boolean;
  isPinned: boolean;
  activeSubScreen: MapSidebarSubScreen;
  navigationPanelVisible: boolean;
  myPlacesPanelVisible: boolean;
  zonesPanelVisible: boolean;
  mapsResourcesVisible: boolean;
  configureScreenVisible: boolean;
  mapMarkersPanelVisible: boolean;
  mapStylePickerVisible: boolean;
  routeParametersPanelVisible: boolean;
  osmExtractorVisible: boolean;
  recordingPanelVisible: boolean;

  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  togglePin: () => void;
  openSubScreen: (screen: MapSidebarSubScreen) => void;
  closeSubScreen: () => void;
  openNavigationPanel: () => void;
  closeNavigationPanel: () => void;
  openMyPlacesPanel: () => void;
  closeMyPlacesPanel: () => void;
  openZonesPanel: () => void;
  closeZonesPanel: () => void;
  openMapsResources: () => void;
  closeMapsResources: () => void;
  openConfigureScreen: () => void;
  closeConfigureScreen: () => void;
  openMapMarkersPanel: () => void;
  closeMapMarkersPanel: () => void;
  openMapStylePicker: () => void;
  closeMapStylePicker: () => void;
  openRouteParametersPanel: () => void;
  closeRouteParametersPanel: () => void;
  openOSMExtractor: () => void;
  closeOSMExtractor: () => void;
  openRecordingPanel: () => void;
  closeRecordingPanel: () => void;
}

export const useMapSidebarStore = create<MapSidebarStore>((set) => ({
  isOpen: false,
  isPinned: false,
  activeSubScreen: null,
  navigationPanelVisible: false,
  myPlacesPanelVisible: false,
  zonesPanelVisible: false,
  mapsResourcesVisible: false,
  configureScreenVisible: false,
  mapMarkersPanelVisible: false,
  mapStylePickerVisible: false,
  routeParametersPanelVisible: false,
  osmExtractorVisible: false,
  recordingPanelVisible: false,

  openSidebar: () => set({ isOpen: true }),
  closeSidebar: () => set({ isOpen: false, activeSubScreen: null }),
  toggleSidebar: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      activeSubScreen: state.isOpen ? null : state.activeSubScreen,
    })),
  togglePin: () => set((state) => ({ isPinned: !state.isPinned })),
  openSubScreen: (screen) => set({ activeSubScreen: screen }),
  closeSubScreen: () => set({ activeSubScreen: null }),
  openNavigationPanel: () =>
    set({ isOpen: false, activeSubScreen: null, navigationPanelVisible: true }),
  closeNavigationPanel: () => set({ navigationPanelVisible: false }),
  openMyPlacesPanel: () =>
    set({ isOpen: false, activeSubScreen: null, myPlacesPanelVisible: true }),
  closeMyPlacesPanel: () => set({ myPlacesPanelVisible: false }),
  openZonesPanel: () =>
    set({ isOpen: false, activeSubScreen: null, zonesPanelVisible: true }),
  closeZonesPanel: () => set({ zonesPanelVisible: false }),
  openMapsResources: () =>
    set({ isOpen: false, activeSubScreen: null, mapsResourcesVisible: true }),
  closeMapsResources: () => set({ mapsResourcesVisible: false }),
  openConfigureScreen: () =>
    set({ isOpen: false, activeSubScreen: null, configureScreenVisible: true }),
  closeConfigureScreen: () => set({ configureScreenVisible: false }),
  openMapMarkersPanel: () =>
    set({ isOpen: false, activeSubScreen: null, mapMarkersPanelVisible: true }),
  closeMapMarkersPanel: () => set({ mapMarkersPanelVisible: false }),
  openMapStylePicker: () =>
    set({ isOpen: false, activeSubScreen: null, mapStylePickerVisible: true }),
  closeMapStylePicker: () => set({ mapStylePickerVisible: false }),
  openRouteParametersPanel: () =>
    set({
      isOpen: false,
      activeSubScreen: null,
      routeParametersPanelVisible: true,
    }),
  closeRouteParametersPanel: () => set({ routeParametersPanelVisible: false }),
  openOSMExtractor: () =>
    set({ isOpen: false, activeSubScreen: null, osmExtractorVisible: true }),
  closeOSMExtractor: () => set({ osmExtractorVisible: false }),
  openRecordingPanel: () =>
    set({ isOpen: false, activeSubScreen: null, recordingPanelVisible: true }),
  closeRecordingPanel: () => set({ recordingPanelVisible: false }),
}));
