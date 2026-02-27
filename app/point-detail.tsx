import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Linking,
} from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import type { CollectionPoint } from "@/types";
import { storage } from "@/lib/storage";
import { MapillaryViewer } from "@/components/MapillaryViewer";
import { openMapillaryCapture } from "@/lib/mapillary";

export default function PointDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { pointId } = useLocalSearchParams<{ pointId: string }>();
  const [point, setPoint] = useState<CollectionPoint | null>(null);
  const [notes, setNotes] = useState("");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [streetViewVisible, setStreetViewVisible] = useState(false);

  useEffect(() => {
    loadPoint();
  }, [pointId]);

  const loadPoint = async () => {
    const route = await storage.loadRoute();
    if (!route) return;

    const foundPoint = route.points.find((p) => p.id === pointId);
    if (foundPoint) {
      setPoint(foundPoint);
      setNotes(foundPoint.notes || "");
    }
  };

  const handleMarkComplete = async () => {
    if (!point) return;

    hapticImpact();

    const route = await storage.loadRoute();
    if (!route) return;

    await storage.updateCollectionPoint(route.id, point.id, {
      status: "completed",
      lastCollectionDate: new Date().toISOString(),
    });

    router.back();
  };

  const handleSaveNotes = async () => {
    if (!point) return;

    hapticImpact();

    const route = await storage.loadRoute();
    if (!route) return;

    await storage.updateCollectionPoint(route.id, point.id, {
      notes: notes.trim(),
    });

    setIsEditingNotes(false);
    await loadPoint();
  };

  const handleReportIssue = async () => {
    if (!point) return;

    Alert.alert(
      "Report Issue",
      "What type of issue would you like to report?",
      [
        {
          text: "Blocked Access",
          onPress: async () => {
            const route = await storage.loadRoute();
            if (!route) return;
            await storage.updateCollectionPoint(route.id, point.id, {
              status: "issue",
              notes: (point.notes || "") + "\n[Issue: Blocked Access]",
            });
            await loadPoint();
          },
        },
        {
          text: "Hazard",
          onPress: async () => {
            const route = await storage.loadRoute();
            if (!route) return;
            await storage.updateCollectionPoint(route.id, point.id, {
              status: "issue",
              notes: (point.notes || "") + "\n[Issue: Hazard]",
            });
            await loadPoint();
          },
        },
        {
          text: "Other",
          onPress: () => {
            Alert.prompt(
              "Describe Issue",
              "Please describe the issue:",
              async (description) => {
                if (!description?.trim()) return;
                const route = await storage.loadRoute();
                if (!route) return;
                await storage.updateCollectionPoint(route.id, point.id, {
                  status: "issue",
                  notes: (point.notes || "") + `\n[Issue: ${description.trim()}]`,
                });
                await loadPoint();
              },
              "plain-text",
              "",
              "default"
            );
          },
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleNavigate = () => {
    if (!point) return;

    hapticImpact();

    const url = `https://maps.apple.com/?daddr=${point.latitude},${point.longitude}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Error", "Could not open maps.");
    });
  };

  if (!point) {
    return (
      <ScreenContainer className="items-center justify-center">
        <Text className="text-muted">Loading...</Text>
      </ScreenContainer>
    );
  }

  const getStatusColor = (status: CollectionPoint["status"]) => {
    switch (status) {
      case "completed":
        return colors.success;
      case "pending":
        return colors.warning;
      case "skipped":
        return colors.muted;
      case "issue":
        return colors.error;
      default:
        return colors.muted;
    }
  };

  const getCollectionTypeLabel = (type: CollectionPoint["collectionType"]) => {
    switch (type) {
      case "residential":
        return "Residential";
      case "commercial":
        return "Commercial";
      case "recycling":
        return "Recycling";
      case "bulk":
        return "Bulk";
      default:
        return type;
    }
  };

  return (
    <ScreenContainer>
      <ScrollView className="flex-1 p-4">
        {/* Header */}
        <View className="mb-6">
          <TouchableOpacity
            onPress={() => router.back()}
            className="mb-4 active:opacity-70"
          >
            <Text className="text-primary text-base font-medium">← Back</Text>
          </TouchableOpacity>

          <Text className="text-3xl font-bold text-foreground mb-2">
            {point.address}
          </Text>
          {point.locationName && (
            <Text className="text-lg text-muted">{point.locationName}</Text>
          )}
        </View>

        {/* Status Badge */}
        <View
          className="self-start px-4 py-2 rounded-full mb-6"
          style={{ backgroundColor: getStatusColor(point.status) + "20" }}
        >
          <Text
            className="text-sm font-medium"
            style={{ color: getStatusColor(point.status) }}
          >
            {point.status.charAt(0).toUpperCase() + point.status.slice(1)}
          </Text>
        </View>

        {/* Details Card */}
        <View
          className="bg-surface rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <View className="mb-4">
            <Text className="text-sm text-muted mb-1">Collection Type</Text>
            <Text className="text-base font-semibold text-foreground">
              {getCollectionTypeLabel(point.collectionType)}
            </Text>
          </View>

          {point.scheduledTime && (
            <View className="mb-4">
              <Text className="text-sm text-muted mb-1">Scheduled Time</Text>
              <Text className="text-base font-semibold text-foreground">
                {point.scheduledTime}
              </Text>
            </View>
          )}

          {point.specialInstructions && (
            <View className="mb-4">
              <Text className="text-sm text-muted mb-1">
                Special Instructions
              </Text>
              <Text className="text-base text-foreground">
                {point.specialInstructions}
              </Text>
            </View>
          )}

          {point.lastCollectionDate && (
            <View>
              <Text className="text-sm text-muted mb-1">Last Collection</Text>
              <Text className="text-base text-foreground">
                {new Date(point.lastCollectionDate).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>

        {/* Notes Section */}
        <View
          className="bg-surface rounded-2xl p-5 mb-4"
          style={{ backgroundColor: colors.surface }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-lg font-semibold text-foreground">Notes</Text>
            {!isEditingNotes && (
              <TouchableOpacity
                onPress={() => setIsEditingNotes(true)}
                className="active:opacity-70"
              >
                <Text className="text-primary font-medium">Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {isEditingNotes ? (
            <>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Add notes about this collection point..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={4}
                className="bg-background rounded-lg p-3 text-foreground mb-3"
                style={{
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  minHeight: 100,
                  textAlignVertical: "top",
                }}
              />
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={handleSaveNotes}
                  style={{ backgroundColor: colors.primary }}
                  className="flex-1 py-3 rounded-lg items-center active:opacity-70"
                >
                  <Text className="text-white font-semibold">Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setNotes(point.notes || "");
                    setIsEditingNotes(false);
                  }}
                  style={{ backgroundColor: colors.muted + "30" }}
                  className="flex-1 py-3 rounded-lg items-center active:opacity-70"
                >
                  <Text className="text-foreground font-semibold">Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text className="text-base text-foreground">
              {point.notes || "No notes added yet"}
            </Text>
          )}
        </View>

        {/* Action Buttons */}
        <View className="gap-3 mb-6">
          {point.status === "pending" && (
            <TouchableOpacity
              onPress={handleMarkComplete}
              style={{ backgroundColor: colors.success }}
              className="py-4 rounded-xl items-center active:opacity-70"
            >
              <Text className="text-white text-base font-semibold">
                Mark as Completed
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={handleNavigate}
            style={{ backgroundColor: colors.primary }}
            className="py-4 rounded-xl items-center active:opacity-70"
          >
            <Text className="text-white text-base font-semibold">
              Navigate to Location
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              hapticImpact();
              setStreetViewVisible(true);
            }}
            style={{ backgroundColor: "#3B82F6" }}
            className="py-4 rounded-xl items-center active:opacity-70"
          >
            <Text className="text-white text-base font-semibold">
              Street View
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              hapticImpact();
              openMapillaryCapture();
            }}
            style={{ backgroundColor: "#10B981" }}
            className="py-4 rounded-xl items-center active:opacity-70"
          >
            <Text className="text-white text-base font-semibold">
              Contribute images
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleReportIssue}
            style={{ backgroundColor: colors.error }}
            className="py-4 rounded-xl items-center active:opacity-70"
          >
            <Text className="text-white text-base font-semibold">
              Report Issue
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <MapillaryViewer
        latitude={point.latitude}
        longitude={point.longitude}
        isVisible={streetViewVisible}
        onClose={() => setStreetViewVisible(false)}
      />
    </ScreenContainer>
  );
}
