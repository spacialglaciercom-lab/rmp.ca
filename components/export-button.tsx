import { TouchableOpacity, Text, View, Alert, Platform } from "react-native";
import {
  impactAsync as hapticImpact,
  notificationAsync as hapticNotification,
  NotificationFeedbackType,
} from "@/lib/safe-haptics";
import { useRouting } from "@/lib/routing-context";
import {
  exportRouteAsZip,
  exportRouteAsZipNative,
  type ExportData,
} from "@/lib/zip-export";
import { useColors } from "@/hooks/use-colors";
import { useState } from "react";

export interface ExportButtonProps {
  onExportStart?: () => void;
  onExportComplete?: () => void;
  onExportError?: (error: Error) => void;
}

/**
 * Export Button Component
 * Allows users to export route data as a ZIP file
 * Includes error handling and user feedback
 */
export function ExportButton({
  onExportStart,
  onExportComplete,
  onExportError,
}: ExportButtonProps) {
  const colors = useColors();
  const { state } = useRouting();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      hapticImpact();

      // Check if we have route data to export
      if (!state.gpxData && !state.statistics && !state.report) {
        Alert.alert(
          "No Route Data",
          "Please generate a route first before exporting. Import an OSM file and optimize a route.",
        );
        return;
      }

      setIsExporting(true);
      onExportStart?.();

      // Prepare export data
      const exportData: ExportData = {
        gpxData: state.gpxData,
        statistics: state.statistics,
        report: state.report,
        configuration: state.configuration,
        timestamp: new Date(),
      };

      const filename = state.configuration.outputFileName ?? "trash_route";

      if (Platform.OS === "web") {
        await exportRouteAsZip(exportData, filename);
        hapticNotification(NotificationFeedbackType.Success);
        Alert.alert(
          "Export Successful",
          "Your route has been exported as a ZIP file and should appear in your downloads folder.",
        );
      } else {
        await exportRouteAsZipNative(exportData, filename);
        hapticNotification(NotificationFeedbackType.Success);
        Alert.alert(
          "Export Successful",
          "Share or save the ZIP file to Files, Drive, or another app.",
        );
      }

      onExportComplete?.();
    } catch (error) {
      // Error feedback
      hapticNotification(NotificationFeedbackType.Error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Export failed:", errorMessage);

      Alert.alert("Export Failed", `Unable to export route: ${errorMessage}`);

      onExportError?.(error instanceof Error ? error : new Error(errorMessage));
    } finally {
      setIsExporting(false);
    }
  };

  const isDisabled = !state.gpxData && !state.statistics && !state.report;

  return (
    <TouchableOpacity
      onPress={handleExport}
      disabled={isDisabled || isExporting}
      style={{
        opacity: isDisabled || isExporting ? 0.5 : 1,
      }}
    >
      <View
        className="px-5 py-4 active:opacity-70"
        style={{
          backgroundColor: isDisabled ? colors.border : colors.primary + "10",
        }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text
              className="text-base font-medium"
              style={{
                color: isDisabled ? colors.muted : colors.primary,
              }}
            >
              {isExporting ? "Exporting..." : "Export Route as ZIP"}
            </Text>
            <Text className="text-xs text-muted mt-1">
              {isDisabled
                ? "Generate a route first to enable export"
                : "Download all route data (GPX, statistics, report)"}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}
