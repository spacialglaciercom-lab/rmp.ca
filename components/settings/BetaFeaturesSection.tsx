import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Switch,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
  Pressable,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useBetaFeatures } from "@/context/BetaFeaturesContext";
import { useColors } from "@/hooks/use-colors";

type LeapStatus = { linked: boolean; modelLoaded: boolean; loadError?: string | null } | null;

export const BetaFeaturesSection: React.FC = () => {
  const colors = useColors();
  const [leapStatus, setLeapStatus] = useState<LeapStatus>(null);
  const [verifyingLeap, setVerifyingLeap] = useState(false);
  const {
    features,
    enableBeta,
    disableBeta,
    toggleTurnAware,
    toggleLearnedPenalties,
    toggleWeatherOptimizedRouting,
    toggleVoiceCoPilot,
    toggleRouteMasterConstraints,
    isExperimentalRoute,
  } = useBetaFeatures();

  const handleEnableBeta = () => {
    if (Platform.OS === "web") {
      const message =
        "Enable experimental features? Research teams are beta-testing. Enable at your own risk. Routes may be suboptimal or calculation may fail.";
      if (typeof window !== "undefined" && window.confirm(message)) {
        enableBeta();
      }
    } else {
      Alert.alert(
        "Enable Experimental Features?",
        "Research teams are beta-testing these features. Enable at your own risk. Routes may be suboptimal or calculation may fail.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Enable", style: "destructive", onPress: enableBeta },
        ]
      );
    }
  };

  const onToggleBeta = () => {
    if (features.enabled) {
      disableBeta();
    } else {
      handleEnableBeta();
    }
  };

  const switchTrack = { false: colors.border, true: colors.accentCyan ?? colors.primary };
  const thumbColor = Platform.OS === "android" ? (features.enabled ? colors.accentCyan : colors.muted) : undefined;

  const refreshLeapStatus = useCallback(async () => {
    if (Platform.OS === "web") {
      setLeapStatus({ linked: false, modelLoaded: false, loadError: "web platform" });
      return;
    }
    try {
      const { getLeapStatus } = await import("@/modules/leap-extract/src");
      const status = await getLeapStatus();
      setLeapStatus(status);
    } catch {
      setLeapStatus({ linked: false, modelLoaded: false, loadError: "status check failed" });
    }
  }, []);

  const handleVerifyLeap = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Leap SDK", "N/A on web. Use an iOS dev build to verify.");
      return;
    }
    setVerifyingLeap(true);
    try {
      const { getLeapStatus, extractAsync } = await import("@/modules/leap-extract/src");
      const status = await getLeapStatus();
      setLeapStatus(status);

      if (!status.linked) {
        Alert.alert(
          "Leap SDK verification",
          `Leap SDK is not linked.\n\n${status.loadError ? `Error: ${status.loadError}\n\n` : ""}Use a development or production build that includes the leap-extract native module (Expo Go does not include it).`
        );
        return;
      }

      if (!status.modelLoaded) {
        // Try to actively load the model instead of just reporting
        Alert.alert(
          "Leap SDK",
          `Module is linked but model not loaded yet.${status.loadError ? `\n\nLast error: ${status.loadError}` : ""}\n\nWould you like to download and load the model now? (requires network, ~800MB)`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Load Model",
              onPress: async () => {
                try {
                  const { preloadModel, getLeapStatus: recheck } = await import("@/modules/leap-extract/src");
                  const result = await preloadModel();
                  const updated = await recheck();
                  setLeapStatus(updated);
                  if (updated.modelLoaded) {
                    Alert.alert("Leap SDK", "Model loaded successfully!");
                  } else {
                    Alert.alert("Leap SDK", `Model load returned "${result}"${updated.loadError ? `\n\nError: ${updated.loadError}` : ""}`);
                  }
                } catch (loadErr) {
                  const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
                  Alert.alert("Leap SDK", `Model load failed:\n${msg}`);
                }
              },
            },
          ]
        );
        return;
      }

      try {
        const result = await extractAsync("Leap SDK verify test", { schemaHint: null });
        const parsed = typeof result === "string" ? result : JSON.stringify(result);
        Alert.alert(
          "Leap SDK verified",
          `Linked ✓\nModel loaded ✓\nExtract test succeeded.\n\nSample output length: ${parsed.length} chars`
        );
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        Alert.alert("Leap SDK verification", `Linked and model loaded, but extract test failed:\n${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLeapStatus({ linked: false, modelLoaded: false, loadError: msg });
      Alert.alert("Leap SDK verification", `Check failed: ${msg}`);
    } finally {
      setVerifyingLeap(false);
    }
  }, []);

  useEffect(() => {
    if (features.enabled) refreshLeapStatus();
    else setLeapStatus(null);
  }, [features.enabled, refreshLeapStatus]);

  return (
    <ScrollView style={styles.container} scrollEnabled={false}>
      {features.enabled && (
        <View
          style={[
            styles.warningBanner,
            {
              backgroundColor: (colors.warning ?? "#ff6b4a") + "18",
              borderColor: colors.warning ?? "#ff6b4a",
            },
          ]}
        >
          <Text style={[styles.warningText, { color: colors.warning ?? "#ff6b4a" }]}>
            ⚡ EXPERIMENTAL MODE ACTIVE
          </Text>
          {isExperimentalRoute && (
            <Text style={[styles.subWarning, { color: colors.muted }]}>Turn-aware routing enabled</Text>
          )}
        </View>
      )}

      <Pressable
        style={[styles.row, { borderBottomColor: colors.border }]}
        onPress={onToggleBeta}
        accessibilityRole="switch"
        accessibilityState={{ checked: features.enabled }}
        accessibilityLabel="Enable Beta Features"
      >
        <View style={[styles.labelContainer, { pointerEvents: "none" }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>Enable Beta Features</Text>
          <Text style={[styles.description, { color: colors.muted }]}>
            Weather-optimized routing, Leap AI (iOS), turn-aware & learned penalties
          </Text>
        </View>
        <View>
          <Switch
            value={features.enabled}
            onValueChange={(value) => {
              if (value) handleEnableBeta();
              else disableBeta();
            }}
            trackColor={switchTrack}
            thumbColor={thumbColor}
          />
        </View>
      </Pressable>

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>Turn-aware CPP</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              CPP variant with explicit turn modeling
            </Text>
          </View>
          <Switch
            value={features.turnAwareCpp}
            onValueChange={toggleTurnAware}
            trackColor={switchTrack}
            thumbColor={Platform.OS === "android" ? (features.turnAwareCpp ? colors.accentCyan : colors.muted) : undefined}
          />
        </View>
      )}

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>Learned Penalties</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              Bias routes using on-device model (narrow/time-restricted edges). iOS only.
            </Text>
          </View>
          <Switch
            value={features.learnedPenalties}
            onValueChange={toggleLearnedPenalties}
            trackColor={switchTrack}
            thumbColor={Platform.OS === "android" ? (features.learnedPenalties ? colors.accentCyan : colors.muted) : undefined}
          />
        </View>
      )}

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>Weather-Optimized Routing</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              OpenWeatherMap + Leap AI (iOS). Set EXPO_PUBLIC_OPENWEATHERMAP_API_KEY for weather data.
            </Text>
          </View>
          <Switch
            value={features.weatherOptimizedRouting}
            onValueChange={toggleWeatherOptimizedRouting}
            trackColor={switchTrack}
            thumbColor={Platform.OS === "android" ? (features.weatherOptimizedRouting ? colors.accentCyan : colors.muted) : undefined}
          />
        </View>
      )}

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>AI Co-Pilot</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              Voice/text companion while driving or parked. Uses server AI (no API key needed).
            </Text>
          </View>
          <Switch
            value={features.voiceCoPilot}
            onValueChange={toggleVoiceCoPilot}
            trackColor={switchTrack}
            thumbColor={Platform.OS === "android" ? (features.voiceCoPilot ? colors.accentCyan : colors.muted) : undefined}
          />
        </View>
      )}

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>RouteMaster Constraints</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              Parse natural language into route constraints using Gemini AI (Firebase).
            </Text>
          </View>
          <Switch
            value={features.routeMasterConstraints}
            onValueChange={toggleRouteMasterConstraints}
            trackColor={switchTrack}
            thumbColor={Platform.OS === "android" ? (features.routeMasterConstraints ? colors.accentCyan : colors.muted) : undefined}
          />
        </View>
      )}

      {features.enabled && (
        <View style={[styles.row, styles.indented, { borderBottomColor: colors.border, backgroundColor: colors.surface + "80" }]}>
          <View style={styles.labelContainer}>
            <Text style={[styles.label, { color: colors.foreground }]}>Leap SDK status</Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {Platform.OS === "web"
                ? "N/A (web)"
                : leapStatus === null
                  ? "Checking…"
                  : !leapStatus.linked
                    ? "Not linked (Expo Go or build without leap-extract)"
                    : leapStatus.modelLoaded
                      ? "Linked ✓ · Model loaded ✓"
                      : "Linked ✓ · Model not yet loaded (loads on first use)"}
            </Text>
          </View>
          {Platform.OS !== "web" && (
            <TouchableOpacity
              onPress={handleVerifyLeap}
              disabled={verifyingLeap}
              style={[
                styles.verifyButton,
                {
                  borderColor: colors.border,
                  opacity: verifyingLeap ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Verify Leap SDK"
            >
              {verifyingLeap ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <Text style={[styles.verifyButtonText, { color: colors.foreground }]}>Verify</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {features.turnAwareCpp && (
        <View style={[styles.penaltyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.penaltyTitle, { color: colors.foreground }]}>Current Static Penalties</Text>
          <Text style={[styles.penaltyItem, { color: colors.muted }]}>Straight: 2s</Text>
          <Text style={[styles.penaltyItem, { color: colors.muted }]}>Right: 8s</Text>
          <Text style={[styles.penaltyItem, { color: colors.muted }]}>Left: 45s</Text>
          <Text style={[styles.penaltyItem, { color: colors.muted }]}>U-Turn: 120s</Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 0,
  },
  warningBanner: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  warningText: {
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.8,
  },
  subWarning: {
    fontSize: 12,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  indented: {
    paddingLeft: 24,
  },
  labelContainer: {
    flex: 1,
    marginRight: 12,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  description: {
    fontSize: 12,
    marginTop: 2,
  },
  penaltyCard: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  penaltyTitle: {
    fontWeight: "700",
    marginBottom: 8,
    fontSize: 13,
  },
  penaltyItem: {
    fontSize: 13,
    marginVertical: 2,
  },
  verifyButton: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  verifyButtonText: {
    fontSize: 12,
    fontWeight: "500",
  },
  apiKeySection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  apiKeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  apiKeyInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  saveKeyButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  saveKeyText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
