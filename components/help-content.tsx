import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  Share,
} from "react-native";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { Fonts } from "@/lib/_core/theme";
import { MinimalCard, SectionLabel } from "@/components/minimal";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useHelpStore } from "@/stores/helpStore";

type HelpTab = "topics" | "battery";

interface HelpSection {
  id: string;
  title: string;
  icon: string;
  content: string[];
}

const helpSections: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "play-circle-outline",
    content: [
      "RouteMasterPro plans efficient routes for both waste collection and delivery operations.",
      "Planner tab: import an OSM file to build a road-network route. The backend optimizes it using a Chinese Postman algorithm and returns turn-by-turn directions.",
      "Zones tab – Delivery mode: tap '＋ New partition', paste polygon coordinates, choose truck count and balance metric, then tap Run Partition. The backend extracts roads and splits them into balanced zones.",
      "Zones tab – Waste mode: add bin/dumpster locations on the map (manually, from GPS, or via CSV/GeoJSON import), then run Partition to group them by truck.",
      "Map tab: view your route, toggle map layers, and use the Extract panel to pull Overture road data for a polygon area.",
      "Use the Settings tab to enable or disable feature plugins (weather, route optimizer, Overture extraction, zones, AI chat, and more).",
    ],
  },
  {
    id: "map-features",
    title: "Map Features",
    icon: "map-outline",
    content: [
      "Interactive map with zoom, pan, and rotate controls.",
      "View collection points, route lines, and navigation markers.",
      "Toggle between different map layers and styles.",
      "Download Overture Maps data for offline routing in areas with poor connectivity.",
      "Use GPS to track your current location during collection.",
    ],
  },
  {
    id: "route-planning",
    title: "Route Planning",
    icon: "map-marker-path",
    content: [
      "Import an OSM file in the Planner tab to load road network data (nodes, ways, turn restrictions).",
      "The backend optimizer runs a Chinese Postman Problem (CPP) algorithm to find the shortest path that covers every road segment at least once.",
      "Configure turn penalties (left turn, U-turn) and oneway mode to reflect real-world driving constraints.",
      "Use 'Service both sides' mode to optimize two-pass collection on wide streets.",
      "Export your optimized route as a GPX file to load into navigation apps.",
      "The Route Optimizer plugin must be enabled in Settings → Plugins for optimization to work.",
    ],
  },
  {
    id: "navigation",
    title: "Navigation",
    icon: "navigation-variant-outline",
    content: [
      "Turn-by-turn navigation during collection routes.",
      "Voice guidance for hands-free operation.",
      "Real-time route adjustments based on conditions.",
      "Mark collection points as completed during navigation.",
      "Emergency routing to handle unexpected road closures.",
    ],
  },
  {
    id: "weather",
    title: "Weather Integration",
    icon: "weather-partly-cloudy",
    content: [
      "View current weather conditions for your route area.",
      "Get weather forecasts to plan collection schedules.",
      "Automatic route adjustments for severe weather.",
      "Weather-based collection point prioritization.",
    ],
  },
  {
    id: "settings",
    title: "Settings & Configuration",
    icon: "cog-outline",
    content: [
      "Customize map appearance and color schemes.",
      "Configure route optimization preferences.",
      "Manage Overture Maps offline data downloads and storage.",
      "Adjust notification and alert preferences.",
    ],
  },
  {
    id: "load-instructions",
    title: "Load instructions",
    icon: "file-document-outline",
    content: [
      "Delivery or collection instructions can be loaded from JSON and are matched to route stops by address.",
      "Instructions are imported at app startup from data/deliveryInstructions.json.",
      "Each instruction needs: address (matched to the stop label), title (e.g. Gate Code), and details (e.g. 1234#).",
      "Example — minimal JSON file:",
      '{"instructions":[{"address":"123 Main St","title":"Gate Code","details":"1234#"},{"address":"456 Oak Ave","title":"Use Back Door","details":"Rear entrance"}]}',
      "Add or edit data/deliveryInstructions.json in the project, then restart the app. Matched instructions appear as special instructions on collection points in the planner and map.",
    ],
  },
  {
    id: "delivery-zones",
    title: "Delivery Zones",
    icon: "vector-polygon",
    content: [
      "The Delivery mode on the Zones tab lets you split a geographic area into balanced truck zones without going through the Extract tab.",
      "Tap '＋ New partition' (sidebar) or '＋ Create zone partition' (empty map area) to open the partition sheet.",
      "Enter the polygon boundary as a JSON array — [[lat,lon],[lat,lon],...] — or one lat,lon pair per line. You need at least 3 points.",
      "Set a zone name (optional), choose the number of trucks (1–12), and select the balance metric: Time balances zones by estimated drive time; Distance balances by road length.",
      "Tap 'Run Partition'. The backend extracts the road network for your polygon and runs spectral clustering to create balanced zones. This may take up to 2 minutes for large areas.",
      "On success, the zones appear on the map with distinct colors and are saved in the sidebar. Each zone shows its estimated time, distance, and node count.",
      "You can also create delivery zones from the Extract tab: draw a polygon → extract roads → tap 'Partition & send to Zones'.",
    ],
  },
  {
    id: "extract-overture",
    title: "Extract & Overture Maps",
    icon: "download-network-outline",
    content: [
      "The Extract panel (Map tab → ☰ sidebar → Extract) lets you pull Overture Maps road data for any polygon you draw.",
      "Draw a polygon on the map, select road classes to include (residential, tertiary, secondary, etc.), then tap Extract.",
      "Extraction connects to the Overture backend via WebSocket and downloads, clips, and builds a road graph for your area. Progress is shown in real time.",
      "After extraction you can: Optimize route (run CPP on the extracted roads), or Partition & send to Zones (split roads into truck zones and save them to the Zones tab).",
      "The Overture Maps Extraction plugin must be enabled in Settings → Plugins.",
      "For offline use, download Overture data in advance from Settings → Offline Maps so extraction works without an internet connection.",
    ],
  },
  {
    id: "plugins",
    title: "Plugins",
    icon: "puzzle-outline",
    content: [
      "Plugins are optional feature modules you can enable or disable in Settings → Plugins.",
      "Weather: shows a weather overlay on the map and weather-aware route costs in the Planner.",
      "Route Optimizer: enables the CPP optimization backend used by the Planner and Extract tabs.",
      "Overture Maps Extraction: enables the polygon-to-road-network extraction panel on the Map tab.",
      "Zones: enables the Zones tab for delivery and waste zone partitioning.",
      "AI Chat: enables the AI assistant bubble for natural-language route and constraint queries.",
      "Drive Preview: enables the route drive-preview feature in the Planner.",
      "Collection Route & Navigation: enable collection route building and turn-by-turn navigation.",
      "Disabling a plugin removes its UI and stops its background processes. Re-enabling reloads it immediately without restarting the app.",
    ],
  },
  {
    id: "zones-csv-geojson",
    title: "Waste Zones: CSV / GeoJSON import",
    icon: "file-upload-outline",
    content: [
      "On the Zones page you can import waste points (bins or dumpsters) from a CSV or GeoJSON file. Use the toolbar Import button, then choose your file.",
      "CSV format — Use a header row with column names (case-insensitive). Required: lat and lon (or latitude/longitude, or lng for longitude). Optional: type, capacity, condition, address. Separate columns with comma, semicolon, or tab.",
      "CSV columns: lat (or latitude), lon (or lng, longitude), type (bin or dumpster), capacity (liters), condition (good, overflowing, damaged), address (for geocoding if lat/lon missing).",
      "CSV example: lat,lon,type,capacity,address then one row per point, e.g. 45.5017,-73.5673,bin,240,123 Main St.",
      'GeoJSON format — A FeatureCollection of Point features. Each feature must have geometry.type "Point" and geometry.coordinates as [longitude, latitude] (GeoJSON order). Use properties for type, capacity, condition, address.',
      'GeoJSON example: {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[-73.5673,45.5017]},"properties":{"type":"bin","capacity":240,"address":"123 Main St"}}]}.',
      "After import, rows with an address but no coordinates can be geocoded using the Geocode addresses button. You need at least lat/lon or address for each row. Then run Partition to split points into zones.",
    ],
  },
  {
    id: "add-constraints",
    title: "Add constraints",
    icon: "format-list-checks",
    content: [
      "The Add Constraint feature (Planner, with RouteMaster Constraints beta on) turns plain English into route rules. Type instructions as you would tell a dispatcher; the app parses them into structured constraints.",
      "Format: Use natural language. Include what (street, zone, or area), what rule (skip, avoid, time window, etc.), and when it applies (days, times, or permanent).",
      "Examples — one constraint per line or per entry:",
      "• Skip Elm St on Tuesdays",
      "• Avoid Main St during school hours",
      "• Only do Oak Ave before 7am",
      "• Always go northbound on 1st St",
      "• Hit the hospital first every day",
      "• Push Zone 3 to Thursday this week",
      "• Maple Dr needs twice a week now",
      "• Send the small truck to Cedar Lane",
      "• Never go down the alley behind the school",
      "• Honk twice at the gate on Industrial Blvd",
      "Supported types: skip, avoid, time window, direction, priority, delay, frequency, vehicle, crew, seasonal, temporary, permanent, capacity, special instruction. You can combine location + rule + schedule (e.g. “Skip Pine Rd on Mondays and Fridays”). After parsing, review the suggested constraint and confirm or remove it.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "wrench-outline",
    content: [
      "Clear app cache if experiencing performance issues.",
      "Re-download Overture Maps data if navigation problems occur.",
      "Restart the app if GPS location is not working properly.",
      "Contact support if route optimization fails repeatedly.",
    ],
  },
];

const SUPPORT_EMAIL = "droneservicesqc@proton.me";
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=RouteMasterPro%20-%20Support`;

const WEBSITE_URL = "https://routemasterpro.ca/";

const BATTERY_MODES = [
  {
    id: "performance",
    title: "Performance",
    drain: "8–12%/hr",
    desc: "Best for accuracy: high-precision GPS, full map visuals, voice guidance, and frequent route recalculation. Use when battery life is not a concern.",
  },
  {
    id: "balanced",
    title: "Balanced",
    drain: "4–6%/hr",
    desc: "Good balance: navigation-grade GPS, reduced map FPS, essential voice only, screen auto-dims. Recalculates route when you drift ~500 m off course.",
  },
  {
    id: "ultra",
    title: "Ultra Power Saving",
    drain: "1–2%/hr",
    desc: "Max battery life: approximate GPS, minimal grayscale map, critical voice only, fast screen timeout. Recalculates only when ~2 km off route.",
  },
];

export default function HelpContent() {
  const colors = useColors();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HelpTab>("topics");
  const [expandedSection, setExpandedSection] = useState<string | null>(
    "getting-started",
  );

  // Help store actions
  const addViewedHelpSection = useHelpStore((s) => s.addViewedHelpSection);
  const setLastHelpAccess = useHelpStore((s) => s.setLastHelpAccess);

  const toggleSection = (sectionId: string) => {
    hapticImpact();
    setExpandedSection(expandedSection === sectionId ? null : sectionId);
    // Track that user has viewed this section
    addViewedHelpSection(sectionId);
  };

  const handleShareApp = async () => {
    hapticImpact();
    try {
      await Share.share({
        message:
          "Check out RouteMasterPro - the smart route planning app for waste collection!\n\n" +
          WEBSITE_URL,
        title: "RouteMasterPro",
        url: Platform.OS === "ios" ? WEBSITE_URL : undefined,
      });
    } catch (error) {
      console.error("Error sharing app:", error);
    }
  };

  const handleContactSupport = async () => {
    hapticImpact();
    setLastHelpAccess(Date.now());
    try {
      const url = SUPPORT_MAILTO;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
      }
    } catch (e) {
      console.warn("Could not open email client:", e);
      // Fallback: open generic mailto (some environments only support this)
      try {
        await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
      } catch (e2) {
        console.warn("Mailto fallback failed:", e2);
      }
    }
  };

  const handleViewTutorial = () => {
    hapticImpact();
    // In a real app, this might open a video tutorial or guided tour
    console.log("Tutorial functionality would be implemented here");
    // Track help access
    setLastHelpAccess(Date.now());
  };

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={[Fonts.title, { color: colors.text, marginBottom: 8 }]}>
            Help & Support
          </Text>
          <Text style={[Fonts.body, { color: colors.muted, marginBottom: 16 }]}>
            Learn how to use RouteMasterPro effectively
          </Text>

          {/* Tab bar */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.surface,
              borderRadius: 10,
              padding: 4,
              marginBottom: 24,
            }}
          >
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                setActiveTab("topics");
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor:
                  activeTab === "topics" ? colors.primary : "transparent",
                alignItems: "center",
              }}
            >
              <MaterialCommunityIcons
                name="book-open-page-variant-outline"
                size={18}
                color={activeTab === "topics" ? "#fff" : colors.muted}
              />
              <Text
                style={[
                  Fonts.caption,
                  {
                    color: activeTab === "topics" ? "#fff" : colors.muted,
                    fontWeight: activeTab === "topics" ? "600" : "400",
                    marginTop: 4,
                  },
                ]}
              >
                All Topics
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                hapticImpact();
                setActiveTab("battery");
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor:
                  activeTab === "battery" ? colors.primary : "transparent",
                alignItems: "center",
              }}
            >
              <MaterialCommunityIcons
                name="battery-charging-outline"
                size={18}
                color={activeTab === "battery" ? "#fff" : colors.muted}
              />
              <Text
                style={[
                  Fonts.caption,
                  {
                    color: activeTab === "battery" ? "#fff" : colors.muted,
                    fontWeight: activeTab === "battery" ? "600" : "400",
                    marginTop: 4,
                  },
                ]}
              >
                Battery
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {activeTab === "battery" ? (
          /* Battery tab content */
          <View style={{ paddingHorizontal: 16 }}>
            <SectionLabel>Power Saving Modes</SectionLabel>
            <Text
              style={[
                Fonts.caption,
                {
                  color: colors.muted,
                  marginBottom: 16,
                  lineHeight: 20,
                },
              ]}
            >
              Balance battery life with navigation accuracy. Choose a mode in
              Settings → Power Saving (mobile only).
            </Text>
            <View style={{ gap: 12 }}>
              {BATTERY_MODES.map((mode) => (
                <MinimalCard key={mode.id}>
                  <View style={{ padding: 16 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <Text
                        style={[
                          Fonts.body,
                          { color: colors.text, fontWeight: "600" },
                        ]}
                      >
                        {mode.title}
                      </Text>
                      <Text
                        style={[
                          Fonts.caption,
                          { color: colors.primary, fontWeight: "600" },
                        ]}
                      >
                        {mode.drain}
                      </Text>
                    </View>
                    <Text
                      style={[
                        Fonts.caption,
                        {
                          color: colors.muted,
                          lineHeight: 20,
                        },
                      ]}
                    >
                      {mode.desc}
                    </Text>
                  </View>
                </MinimalCard>
              ))}
            </View>
            <View
              style={{
                marginTop: 20,
                padding: 16,
                backgroundColor: colors.surface,
                borderRadius: 12,
              }}
            >
              <Text
                style={[
                  Fonts.body,
                  { color: colors.text, fontWeight: "600", marginBottom: 8 },
                ]}
              >
                Auto-switch
              </Text>
              <Text
                style={[
                  Fonts.caption,
                  {
                    color: colors.muted,
                    lineHeight: 20,
                  },
                ]}
              >
                When enabled, the app automatically switches modes by battery
                level: Performance above 30%, Balanced between 15–30%, and Ultra
                Power Saving below 15%.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/* Quick Actions */}
            <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
              <SectionLabel>Quick Actions</SectionLabel>
              <View style={{ gap: 12 }}>
                <TouchableOpacity
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                  onPress={handleViewTutorial}
                >
                  <MaterialCommunityIcons
                    name="play-circle"
                    size={24}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        Fonts.body,
                        { color: colors.text, fontWeight: "600" },
                      ]}
                    >
                      Watch Tutorial
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      Learn the basics in 5 minutes
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                  onPress={handleContactSupport}
                >
                  <MaterialCommunityIcons
                    name="headset"
                    size={24}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        Fonts.body,
                        { color: colors.text, fontWeight: "600" },
                      ]}
                    >
                      Contact Support
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      {SUPPORT_EMAIL}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                  onPress={handleShareApp}
                >
                  <MaterialCommunityIcons
                    name="share-variant"
                    size={24}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        Fonts.body,
                        { color: colors.text, fontWeight: "600" },
                      ]}
                    >
                      Share App
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      Tell others about RouteMaster Pro
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Help Sections */}
            <View style={{ paddingHorizontal: 16 }}>
              <SectionLabel>Help Topics</SectionLabel>
              <View style={{ gap: 8 }}>
                {helpSections.map((section) => (
                  <MinimalCard key={section.id}>
                    <TouchableOpacity
                      onPress={() => toggleSection(section.id)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 16,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <MaterialCommunityIcons
                          name={section.icon as any}
                          size={24}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            Fonts.body,
                            { color: colors.text, fontWeight: "600" },
                          ]}
                        >
                          {section.title}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name={
                          expandedSection === section.id
                            ? "chevron-up"
                            : "chevron-down"
                        }
                        size={20}
                        color={colors.muted}
                      />
                    </TouchableOpacity>

                    {expandedSection === section.id && (
                      <View
                        style={{ paddingHorizontal: 16, paddingBottom: 16 }}
                      >
                        {section.content.map((paragraph, index) => (
                          <Text
                            key={index}
                            style={[
                              Fonts.caption,
                              {
                                color: colors.muted,
                                marginBottom:
                                  index < section.content.length - 1 ? 8 : 0,
                                lineHeight: 20,
                              },
                            ]}
                          >
                            • {paragraph}
                          </Text>
                        ))}
                      </View>
                    )}
                  </MinimalCard>
                ))}
              </View>
            </View>

            {/* App Info */}
            <View style={{ paddingHorizontal: 16, marginTop: 32 }}>
              <SectionLabel>App Information</SectionLabel>
              <MinimalCard>
                <View style={{ padding: 16, gap: 12 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      Version
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.text }]}>
                      1.0.3
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      Platform
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.text }]}>
                      {Platform.OS === "ios"
                        ? "iOS"
                        : Platform.OS === "android"
                          ? "Android"
                          : "Web"}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={[Fonts.caption, { color: colors.muted }]}>
                      Build
                    </Text>
                    <Text style={[Fonts.caption, { color: colors.text }]}>
                      Production
                    </Text>
                  </View>
                </View>
              </MinimalCard>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
