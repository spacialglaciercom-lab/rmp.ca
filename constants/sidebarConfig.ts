import type { ComponentProps } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

export type SidebarMenuItemId =
  | "map"
  | "layers"
  | "places"
  | "markers"
  | "resources"
  | "navigation"
  | "routeParameters"
  | "osmExtractor"
  | "configure"
  | "settings"
  | "help"
  | "separator1";

export interface SidebarMenuItem {
  id: SidebarMenuItemId;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  showChevron?: boolean;
  isSeparator?: boolean;
}

export const SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { id: "map", label: "Map", icon: "map-outline", showChevron: false },
  { id: "layers", label: "Layers", icon: "layers-outline", showChevron: true },
  { id: "places", label: "My Places", icon: "star-outline", showChevron: true },
  { id: "markers", label: "Map Markers", icon: "map-marker", showChevron: true },
  { id: "resources", label: "Maps & Resources", icon: "folder-download-outline", showChevron: true },
  { id: "navigation", label: "Navigation", icon: "navigation-variant-outline", showChevron: true },
  { id: "routeParameters", label: "Route parameters", icon: "map-marker-path", showChevron: true },
  { id: "osmExtractor", label: "OSM Extractor", icon: "database-export-outline", showChevron: true },
  { id: "separator1", label: "", icon: "minus", isSeparator: true } as SidebarMenuItem,
  { id: "configure", label: "Configure Screen", icon: "monitor-dashboard", showChevron: true },
  { id: "settings", label: "Settings", icon: "cog-outline", showChevron: false },
  { id: "help", label: "Help", icon: "help-circle-outline", showChevron: false },
];

export const SIDEBAR_WIDTH_IPHONE = 280;
export const SIDEBAR_WIDTH_IPAD = 320;
