import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface MarkerItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** "start" | "waypoint" | "custom" */
  type: "start" | "waypoint" | "custom";
  /** Cached reverse-geocoded location (e.g. "Denver, United States") */
  location?: string;
  /** Number of audio/video notes attached */
  mediaNotesCount?: number;
}

interface MarkerListItemProps {
  marker: MarkerItem;
  onPress?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  onAddNote?: () => void;
  showDelete?: boolean;
}

function MarkerListItemInner({
  marker,
  onPress,
  onDelete,
  onRename,
  onAddNote,
  showDelete = false,
}: MarkerListItemProps) {
  const colors = useColors();

  const handlePress = () => {
    if (Platform.OS !== "web") hapticImpact();
    onPress?.();
  };

  const handleDelete = () => {
    if (Platform.OS !== "web") hapticImpact();
    onDelete?.();
  };

  const iconName =
    marker.type === "start"
      ? "flag-checkered"
      : marker.type === "waypoint"
        ? "map-marker"
        : "map-marker-plus";

  const iconColor =
    marker.type === "start"
      ? "#4CAF50"
      : marker.type === "waypoint"
        ? "#4A90D9"
        : colors.muted;

  return (
    <TouchableOpacity
      style={[styles.container, { borderColor: colors.border, backgroundColor: colors.surface }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.left}>
        <MaterialCommunityIcons name={iconName} size={22} color={iconColor} />
        <View style={styles.textCol}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {marker.name}
          </Text>
          <Text style={[styles.coords, { color: colors.muted }]}>
            {marker.lat.toFixed(5)}, {marker.lon.toFixed(5)}
          </Text>
          {marker.location ? (
            <Text style={[styles.location, { color: colors.muted }]} numberOfLines={1}>
              {marker.location}
            </Text>
          ) : null}
          {marker.mediaNotesCount && marker.mediaNotesCount > 0 ? (
            <View style={styles.noteBadge}>
              <MaterialCommunityIcons name="microphone" size={12} color={colors.primary} />
              <Text style={[styles.noteCount, { color: colors.primary }]}>
                {marker.mediaNotesCount} note{marker.mediaNotesCount > 1 ? "s" : ""}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {showDelete && onAddNote && (
        <TouchableOpacity
          onPress={() => {
            if (Platform.OS !== "web") hapticImpact();
            onAddNote();
          }}
          style={styles.actionBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="microphone-plus" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}
      {showDelete && onRename && (
        <TouchableOpacity
          onPress={() => {
            if (Platform.OS !== "web") hapticImpact();
            onRename();
          }}
          style={styles.actionBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      )}
      {showDelete && onDelete && (
        <TouchableOpacity
          onPress={handleDelete}
          style={styles.actionBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="close-circle-outline" size={22} color={colors.muted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textCol: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
  },
  coords: {
    fontSize: 12,
    marginTop: 2,
  },
  location: {
    fontSize: 11,
    marginTop: 1,
    fontStyle: "italic",
  },
  actionBtn: {
    padding: 4,
    marginLeft: 4,
  },
  noteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  noteCount: {
    fontSize: 11,
    fontWeight: "500",
  },
});

export const MarkerListItem = React.memo(MarkerListItemInner);
