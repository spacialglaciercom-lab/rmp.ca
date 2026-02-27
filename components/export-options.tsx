import { useState } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { impactAsync as hapticImpact, notificationAsync as hapticNotification, NotificationFeedbackType } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useRouting } from "@/lib/routing-context";
import { isMockCollectionPoints } from "@/lib/is-mock-route";
import {
  ExportFormat,
  exportToJSON,
  exportToCSV,
  exportStatisticsToCSV,
  exportForFleetManagement,
  getExportExtension,
  generateExportMetadata,
  RouteExportData,
} from "@/lib/export-utils";
import { CollectionPoint } from "@/types";

interface ExportOptionsProps {
  collectionPoints: CollectionPoint[];
}

export function ExportOptions({ collectionPoints }: ExportOptionsProps) {
  const colors = useColors();
  const { state } = useRouting();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("json");
  const [isExporting, setIsExporting] = useState(false);

  const exportFormats: { id: ExportFormat; label: string; description: string }[] = [
    {
      id: "json",
      label: "JSON",
      description: "Full route data with metadata",
    },
    {
      id: "csv",
      label: "CSV",
      description: "Spreadsheet-compatible format",
    },
    {
      id: "fleet",
      label: "Fleet Management",
      description: "Integration with fleet systems",
    },
    {
      id: "gpx",
      label: "GPX",
      description: "GPS device compatible",
    },
  ];

  const handleExport = async () => {
    if (collectionPoints.length === 0 || isMockCollectionPoints(collectionPoints)) {
      Alert.alert("No Data", "No collection points to export");
      return;
    }

    hapticImpact();
    setIsExporting(true);

    try {
      const routeName = state.configuration.outputFileName || "trash_route";
      let content: string;
      let filename: string;

      switch (selectedFormat) {
        case "json": {
          const exportData: RouteExportData = {
            metadata: generateExportMetadata(routeName, collectionPoints.length),
            configuration: {
              turnPenalties: state.configuration.turnPenalties,
              startPoint: state.configuration.startPoint?.coordinates
                ? {
                    latitude: state.configuration.startPoint.coordinates.latitude,
                    longitude: state.configuration.startPoint.coordinates.longitude,
                    name: state.configuration.startPoint.name,
                  }
                : undefined,
            },
            statistics: state.statistics,
            report: state.report,
            collectionPoints,
          };
          content = exportToJSON(exportData);
          filename = `${routeName}${getExportExtension("json")}`;
          break;
        }

        case "csv":
          content = exportToCSV(collectionPoints, state.statistics, routeName);
          filename = `${routeName}${getExportExtension("csv")}`;
          break;

        case "fleet":
          content = exportForFleetManagement(
            collectionPoints,
            state.statistics,
            routeName
          );
          filename = `${routeName}_fleet${getExportExtension("fleet")}`;
          break;

        case "gpx":
          if (state.gpxData) {
            content = state.gpxData;
          } else {
            // Generate basic GPX from collection points
            content = generateBasicGPX(collectionPoints, routeName);
          }
          filename = `${routeName}${getExportExtension("gpx")}`;
          break;

        default:
          throw new Error("Unknown export format");
      }

      // Handle export based on platform
      if (Platform.OS === "web") {
        // Web: Create download link
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        hapticNotification(NotificationFeedbackType.Success);
        Alert.alert("Export Complete", `Downloaded ${filename}`);
      } else {
        // Native: Save to file system and share
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, content);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
        } else {
          Alert.alert("Export Complete", `Saved to ${filename}`);
        }

        hapticNotification(NotificationFeedbackType.Success);
      }
    } catch (error) {
      hapticNotification(NotificationFeedbackType.Error);
      Alert.alert(
        "Export Error",
        error instanceof Error ? error.message : "Failed to export data"
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportStatistics = async () => {
    if (!state.statistics) {
      Alert.alert("No Statistics", "Generate a route first to export statistics");
      return;
    }

    hapticImpact();
    setIsExporting(true);

    try {
      const routeName = state.configuration.outputFileName || "trash_route";
      const content = exportStatisticsToCSV(
        state.statistics,
        state.configuration.turnPenalties,
        routeName
      );
      const filename = `${routeName}_statistics.csv`;

      if (Platform.OS === "web") {
        const blob = new Blob([content], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        hapticNotification(NotificationFeedbackType.Success);
        Alert.alert("Export Complete", `Downloaded ${filename}`);
      } else {
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, content);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
        }

        hapticNotification(NotificationFeedbackType.Success);
      }
    } catch (error) {
      hapticNotification(NotificationFeedbackType.Error);
      Alert.alert("Export Error", "Failed to export statistics");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <View
      className="bg-surface rounded-2xl p-4 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        Export Options
      </Text>
      <Text className="text-sm text-muted mb-4">
        Export route data in various formats for GPS devices or fleet management
      </Text>

      {/* Format Selector */}
      <Text className="text-sm font-medium text-foreground mb-2">
        Export Format
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {exportFormats.map((format) => (
          <TouchableOpacity
            key={format.id}
            onPress={() => {
              hapticImpact();
              setSelectedFormat(format.id);
            }}
            className="px-4 py-2 rounded-xl"
            style={{
              backgroundColor:
                selectedFormat === format.id
                  ? colors.primary
                  : colors.background,
              borderWidth: 1,
              borderColor:
                selectedFormat === format.id ? colors.primary : colors.border,
            }}
          >
            <Text
              className="text-sm font-medium"
              style={{
                color:
                  selectedFormat === format.id ? "#fff" : colors.foreground,
              }}
            >
              {format.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Format Description */}
      <View
        className="p-3 rounded-xl mb-4"
        style={{ backgroundColor: colors.background }}
      >
        <Text className="text-sm text-muted">
          {exportFormats.find((f) => f.id === selectedFormat)?.description}
        </Text>
        {selectedFormat === "fleet" && (
          <Text className="text-xs text-muted mt-2">
            Compatible with major fleet management systems. Includes stop
            sequences, service types, and estimated durations.
          </Text>
        )}
        {selectedFormat === "csv" && (
          <Text className="text-xs text-muted mt-2">
            Open in Excel, Google Sheets, or any spreadsheet application.
            Includes route statistics as comments.
          </Text>
        )}
      </View>

      {/* Export Buttons */}
      <View className="gap-3">
        <TouchableOpacity
          onPress={handleExport}
          disabled={isExporting || collectionPoints.length === 0 || isMockCollectionPoints(collectionPoints)}
          className="py-3 px-4 rounded-xl items-center"
          style={{
            backgroundColor:
              collectionPoints.length > 0 && !isMockCollectionPoints(collectionPoints)
                ? colors.primary
                : colors.muted + "40",
            opacity: isExporting ? 0.7 : 1,
          }}
        >
          <Text className="font-semibold" style={{ color: "#fff" }}>
            {isExporting ? "Exporting..." : `Export as ${selectedFormat.toUpperCase()}`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleExportStatistics}
          disabled={isExporting || !state.statistics}
          className="py-3 px-4 rounded-xl items-center"
          style={{
            backgroundColor: state.statistics
              ? colors.surface
              : colors.muted + "40",
            borderWidth: 1,
            borderColor: state.statistics ? colors.primary : colors.border,
            opacity: isExporting ? 0.7 : 1,
          }}
        >
          <Text
            className="font-semibold"
            style={{
              color: state.statistics ? colors.primary : colors.muted,
            }}
          >
            Export Statistics Only (CSV)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Export Info */}
      <View className="mt-4 pt-4 border-t border-border">
        {state.statistics && (
          <Text className="text-xs text-muted mt-1">
            Route statistics: {state.statistics.totalDistance.toFixed(2)} km,{" "}
            {Math.min(state.statistics.estimatedTime, 24 * 60)} min
          </Text>
        )}
      </View>
    </View>
  );
}

// Helper function to generate basic GPX from collection points
function generateBasicGPX(points: CollectionPoint[], routeName: string): string {
  const timestamp = new Date().toISOString();
  const trackPoints = points
    .map(
      (p) =>
        `      <trkpt lat="${p.latitude}" lon="${p.longitude}">
        <time>${timestamp}</time>
        <name>${escapeXML(p.address)}</name>
      </trkpt>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteMasterPro"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXML(routeName)}</name>
    <time>${timestamp}</time>
    <desc>Route generated by RouteMasterPro</desc>
  </metadata>
  <trk>
    <name>${escapeXML(routeName)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
