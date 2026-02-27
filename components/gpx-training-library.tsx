import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

import { useColors } from "@/hooks/use-colors";
import { useRouting, generateLogEntry, parseGpxTrackPoints } from "@/lib/routing-context";
import { trpc } from "@/lib/trpc";

/**
 * When GPX_TRAINING_PATH is set, lists .gpx files from that folder and lets the user load one
 * into the app (GPX data + map preview).
 */
export function GpxTrainingLibrary() {
  const colors = useColors();
  const { dispatch } = useRouting();
  const list = trpc.gpxTraining.list.useQuery();
  const [loadFilename, setLoadFilename] = useState<string | null>(null);
  const getContent = trpc.gpxTraining.getContent.useQuery(
    { filename: loadFilename! },
    { enabled: !!loadFilename }
  );

  useEffect(() => {
    if (!loadFilename || !getContent.data) return;
    const { content, error } = getContent.data;
    if (error) {
      dispatch({
        type: "ADD_LOG_ENTRY",
        payload: generateLogEntry(`Training file error: ${error}`, "error"),
      });
      setLoadFilename(null);
      return;
    }
    if (content) {
      const points = parseGpxTrackPoints(content);
      dispatch({ type: "SET_GPX_DATA", payload: content });
      dispatch({ type: "SET_PREVIEW_ROUTE", payload: points.length > 0 ? points : null });
      dispatch({
        type: "ADD_LOG_ENTRY",
        payload: generateLogEntry(
          `Loaded "${loadFilename}" (${points.length} points). View on Map tab.`,
          "success"
        ),
      });
    }
    setLoadFilename(null);
  }, [loadFilename, getContent.data, dispatch]);

  if (!list.data?.configured || list.data.files.length === 0) {
    return null;
  }

  const files = list.data.files;
  const loading = !!loadFilename && getContent.isFetching;

  return (
    <View className="mb-6">
      <Text className="text-lg font-semibold text-foreground mb-2">
        Training library
      </Text>
      <Text className="text-sm text-muted mb-3">
        Load a GPX from your training folder (GPX_TRAINING_PATH) to preview and export
      </Text>
      {loading && (
        <View className="flex-row items-center py-2">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text className="text-muted ml-2">Loading…</Text>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {files.slice(0, 24).map((filename) => (
          <TouchableOpacity
            key={filename}
            onPress={() => {
              if (loadFilename) return;
              hapticImpact();
              setLoadFilename(filename);
            }}
            disabled={!!loadFilename}
            className="bg-muted/60 rounded-lg px-3 py-2 active:opacity-70"
          >
            <Text
              className="text-sm text-foreground"
              numberOfLines={1}
              style={{ maxWidth: 180 }}
            >
              {filename}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {files.length > 24 && (
        <Text className="text-xs text-muted mt-2">
          +{files.length - 24} more files
        </Text>
      )}
    </View>
  );
}
