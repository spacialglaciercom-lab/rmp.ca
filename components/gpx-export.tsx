import { View, Text, TextInput, TouchableOpacity, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { impactAsync as hapticImpact, ImpactFeedbackStyle } from "@/lib/safe-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { useColors } from "@/hooks/use-colors";
import { useRouting, generateLogEntry, parseGpxTrackPoints } from "@/lib/routing-context";

/** When provided (e.g. from Planner), use this so Download/Preview see latest data immediately after generate. */
type GPXExportProps = { gpxDataFromParent?: string | null };

export function GPXExport({ gpxDataFromParent }: GPXExportProps = {}) {
  const colors = useColors();
  const router = useRouter();
  const { state, dispatch } = useRouting();
  const raw = gpxDataFromParent ?? state.gpxData;
  const effectiveGpxData = typeof raw === "string" && raw.length > 0 ? raw : null;

  const handleExportGPX = async () => {
    hapticImpact(ImpactFeedbackStyle.Medium);

    if (!effectiveGpxData) {
      Alert.alert(
        "No Route Generated",
        "Please import OSM data and generate a route first before exporting GPX."
      );
      return;
    }

    dispatch({
      type: "ADD_LOG_ENTRY",
      payload: generateLogEntry("Exporting GPX file...", "info"),
    });

    try {
      const fileName = (state.configuration.outputFileName || "trash_route").replace(/\.gpx$/i, "");
      const gpxContent = effectiveGpxData;

      if (Platform.OS === "web") {
        const blob = new Blob([gpxContent], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName}.gpx`;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(`GPX file "${fileName}.gpx" downloaded successfully`, "success"),
        });

        Alert.alert("Success", `GPX file "${fileName}.gpx" has been downloaded.`);
      } else {
        // Mobile: Save to file system and share
        const fileUri = FileSystem.documentDirectory + `${fileName}.gpx`;
        await FileSystem.writeAsStringAsync(fileUri, gpxContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        dispatch({
          type: "ADD_LOG_ENTRY",
          payload: generateLogEntry(`GPX file saved to device`, "success"),
        });

        // Check if sharing is available
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/gpx+xml",
            dialogTitle: "Export GPX Route",
          });
        } else {
          Alert.alert(
            "File Saved",
            `GPX file saved to: ${fileUri}`,
            [{ text: "OK" }]
          );
        }
      }
    } catch (error) {
      console.error("Error exporting GPX:", error);
      dispatch({
        type: "ADD_LOG_ENTRY",
        payload: generateLogEntry(`Error exporting GPX: ${error}`, "error"),
      });
      Alert.alert("Error", "Failed to export GPX file. Please try again.");
    }
  };

  const handlePreviewGPX = () => {
    hapticImpact();

    if (!effectiveGpxData) {
      Alert.alert(
        "No GPX Data",
        "Generate a route first to preview the GPX route on the map."
      );
      return;
    }

    const points = parseGpxTrackPoints(effectiveGpxData);
    if (points.length === 0) {
      Alert.alert(
        "No Track Points",
        "The GPX data does not contain track points (trkpt) to display."
      );
      return;
    }

    dispatch({ type: "SET_PREVIEW_ROUTE", payload: points });
    router.push("/(tabs)/map");
  };

  return (
    <View
      className="bg-surface rounded-2xl p-5 mb-4"
      style={{ backgroundColor: colors.surface }}
    >
      <Text className="text-lg font-semibold text-foreground mb-2">
        GPX Export
      </Text>
      <Text className="text-sm text-muted mb-4">
        Download the generated route as a GPX file for use in GPS devices or mapping applications.
      </Text>

      {/* File Name Input */}
      <View className="mb-4">
        <Text className="text-xs text-muted mb-1">Output File Name</Text>
        <View
          className="flex-row items-center p-3 rounded-lg"
          style={{ backgroundColor: colors.background }}
        >
          <TextInput
            value={state.configuration.outputFileName || "trash_route"}
            onChangeText={(text) =>
              dispatch({ type: "SET_OUTPUT_FILENAME", payload: text })
            }
            placeholder="trash_route"
            placeholderTextColor={colors.muted}
            className="flex-1 text-foreground"
            style={{ color: colors.foreground, fontSize: 14, padding: 0, margin: 0 }}
          />
          <Text style={{ color: colors.muted }} className="text-sm">.gpx</Text>
        </View>
      </View>

      {/* GPX Status */}
      {effectiveGpxData ? (
        <View
          className="p-3 rounded-lg mb-4"
          style={{ backgroundColor: colors.success + "20" }}
        >
          <Text style={{ color: colors.success }} className="text-sm font-medium">
            ✓ GPX data ready for export
          </Text>
          <Text style={{ color: colors.success }} className="text-xs mt-1">
            {typeof effectiveGpxData === "string" ? effectiveGpxData.length.toLocaleString() : "0"} characters
          </Text>
        </View>
      ) : (
        <View
          className="p-3 rounded-lg mb-4"
          style={{ backgroundColor: colors.warning + "20" }}
        >
          <Text style={{ color: colors.warning }} className="text-sm font-medium">
            ⚠ No route generated yet
          </Text>
          <Text style={{ color: colors.warning }} className="text-xs mt-1">
            Import OSM data and click "Generate Route" first
          </Text>
        </View>
      )}

      {/* Export Buttons: use effectiveGpxData (prop + context) so they enable when parent passes data after generate */}
      <View className="flex-row gap-3">
        <TouchableOpacity
          onPress={handleExportGPX}
          style={{
            backgroundColor: effectiveGpxData ? colors.primary : colors.muted,
            opacity: effectiveGpxData ? 1 : 0.6,
          }}
          className="flex-1 py-4 rounded-xl items-center justify-center active:opacity-70"
          disabled={!effectiveGpxData}
        >
          <Text className="text-white font-semibold">Download GPX</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handlePreviewGPX}
          disabled={!effectiveGpxData}
          style={{
            backgroundColor: effectiveGpxData ? colors.muted + "40" : colors.muted + "25",
            opacity: effectiveGpxData ? 1 : 0.6,
          }}
          className="py-4 px-5 rounded-xl items-center justify-center active:opacity-70 min-w-[100px]"
        >
          <Text className="text-foreground font-semibold">Preview</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
