/**
 * Processor-style home screen with microprocessor aesthetic
 * Replaces the checkered circuit pattern with modern processor design
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { VRPPlanner } from "@/components/VRPPlanner";
import { useColors } from "@/hooks/use-colors";
import type { Route, CollectionPoint } from "@/types";
import { storage } from "@/lib/storage";
import { isMockRoute } from "@/lib/is-mock-route";
import { ProcessorBackground } from "@/components/neo/ProcessorBackground";
import { NeoHeader, NeonCard, NeoPrimaryButton, NeoSectionHeader } from "@/components/neo";

/** Max stops shown in the Processing Queue list to avoid UI/performance issues. Use Map tab for the rest. */
const MAX_PROCESSING_QUEUE_DISPLAY = 500;

export default function ProcessorHomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const [route, setRoute] = useState<Route | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [processorActive, setProcessorActive] = useState(false);

  useEffect(() => {
    loadRoute();
    // Simulate processor activity
    const interval = setInterval(() => {
      setProcessorActive(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadRoute = async () => {
    try {
      const currentRoute = await storage.loadRoute();
      if (!currentRoute) {
        setRoute(null);
        return;
      }
      if (isMockRoute(currentRoute)) {
        await storage.clearRoute();
        setRoute(null);
        return;
      }
      setRoute(currentRoute);
    } catch (e) {
      console.warn("Home: loadRoute failed", e);
      setRoute(null);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRoute();
    setRefreshing(false);
  };

  const handleMarkComplete = async (point: CollectionPoint) => {
    if (!route) return;

    hapticImpact();

    await storage.updateCollectionPoint(route.id, point.id, {
      status: "completed",
      lastCollectionDate: new Date().toISOString(),
    });

    await loadRoute();
  };

  const handlePointPress = (point: CollectionPoint) => {
    hapticImpact();
    router.push({
      pathname: "/point-detail",
      params: { pointId: point.id },
    });
  };

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

  const getStatusLabel = (status: CollectionPoint["status"]) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "pending":
        return "Pending";
      case "skipped":
        return "Skipped";
      case "issue":
        return "Issue";
      default:
        return "Unknown";
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

  const isVrpRoute = route?.routeSource === "vrp";
  const completionPercentage =
    route && route.totalPoints > 0
      ? Math.round((route.completedPoints / route.totalPoints) * 100)
      : 0;

  const subtitle = route
    ? isVrpRoute
      ? `${route.completedPoints}/${route.totalPoints} stops · ${completionPercentage}%`
      : "Route ready · Use Map tab to navigate"
    : "No active route";

  const ProcessorStatusIndicator = () => (
    <View style={[styles.processorIndicator, { backgroundColor: colors.surface + '80' }]}>
      <View style={[
        styles.processorPulse, 
        { 
          backgroundColor: processorActive ? colors.success : colors.primary,
          shadowColor: processorActive ? colors.success : colors.primary,
        }
      ]} />
      <Text style={[styles.processorText, { color: colors.foreground }]}>
        PROCESSOR {processorActive ? 'ACTIVE' : 'STANDBY'}
      </Text>
    </View>
  );

  const processorHeader = (
    <View style={{ marginBottom: 24 }}>
      <ProcessorStatusIndicator />
      
      <NeoHeader
        title="PROCESSOR // ROUTE OS"
        statusLabel="SYSTEM STATUS"
        subtitle={subtitle}
        statusHighlight={true}
      />
      
      {!route ? (
        <NeonCard variant="cyan" padding={20} style={{ marginBottom: 20 }}>
          <View style={styles.processorRow}>
            <View style={[styles.processorIcon, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.processorIconText, { color: colors.primary }]}>⚡</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.processorTitle, { color: colors.foreground }]}>
                Initialize Route Processor
              </Text>
              <Text style={[styles.processorSubtitle, { color: colors.muted }]}>
                Power up the routing system
              </Text>
            </View>
          </View>
          
          <NeoPrimaryButton
            title="Boot Route Processor"
            onPress={() => router.push("/(tabs)/planner")}
            variant="primary"
            style={{ marginTop: 16 }}
          />
          
          <Text style={[styles.processorHint, { color: colors.muted, textAlign: "center" }]}>
            Import OSM data and generate processing routes
          </Text>
        </NeonCard>
      ) : (
        <NeonCard variant="cyan" padding={20} style={{ marginBottom: 20 }}>
          <View style={styles.processorRow}>
            <View style={[styles.processorIcon, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.processorIconText, { color: colors.success }]}>▶</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.processorTitle, { color: colors.foreground }]}>
                Route Processor Active
              </Text>
              <Text style={[styles.processorSubtitle, { color: colors.muted }]}>
                Processing collection points
              </Text>
            </View>
          </View>
          
          {/* Processor-style progress indicators */}
          <View style={styles.processorMetrics}>
            <View style={styles.processorMetric}>
              <Text style={[styles.processorMetricLabel, { color: colors.muted }]}>COMPLETED</Text>
              <Text style={[styles.processorMetricValue, { color: colors.success }]}>
                {route.completedPoints}
              </Text>
            </View>
            <View style={styles.processorMetric}>
              <Text style={[styles.processorMetricLabel, { color: colors.muted }]}>PENDING</Text>
              <Text style={[styles.processorMetricValue, { color: colors.warning }]}>
                {route.totalPoints - route.completedPoints}
              </Text>
            </View>
            <View style={styles.processorMetric}>
              <Text style={[styles.processorMetricLabel, { color: colors.muted }]}>EFFICIENCY</Text>
              <Text style={[styles.processorMetricValue, { color: colors.primary }]}>
                {completionPercentage}%
              </Text>
            </View>
          </View>
          
          {/* Processor-style progress bar */}
          <View style={styles.processorProgressBar}>
            <View 
              style={[
                styles.processorProgressFill, 
                { 
                  width: `${completionPercentage}%`,
                  backgroundColor: completionPercentage >= 80 ? colors.success : 
                                  completionPercentage >= 50 ? colors.warning : colors.primary
                }
              ]} 
            />
          </View>
        </NeonCard>
      )}

      <NeonCard variant="magenta" padding={16} style={{ marginBottom: 20 }}>
        <View style={styles.processorRow}>
          <View style={[styles.processorIcon, { backgroundColor: colors.accentMagenta + '20' }]}>
            <Text style={[styles.processorIconText, { color: colors.accentMagenta }]}>🔄</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.processorTitle, { color: colors.foreground }]}>
              VRP Optimization Engine
            </Text>
            <Text style={[styles.processorSubtitle, { color: colors.muted }]}>
              Advanced route processing algorithms
            </Text>
          </View>
        </View>
        <VRPPlanner nestedInScrollView={Platform.OS !== "web"} />
      </NeonCard>
    </View>
  );

  const renderCollectionPoint = ({ item }: { item: CollectionPoint }) => (
    <TouchableOpacity 
      onPress={() => handlePointPress(item)} 
      style={{ marginBottom: 12 }} 
      activeOpacity={0.85}
    >
      <NeonCard variant="cyan" padding={16} notchSize={10} borderRadius={12}>
        <View style={styles.processorRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.processorPointAddress, { color: colors.foreground }]}>
              {item.address}
            </Text>
            {item.locationName && (
              <Text style={[styles.processorPointLocation, { color: colors.muted }]}>
                {item.locationName}
              </Text>
            )}
          </View>
          <View
            style={[
              styles.processorStatusBadge,
              { backgroundColor: getStatusColor(item.status) + "20" }
            ]}
          >
            <Text style={[styles.processorStatusText, { color: getStatusColor(item.status) }]}>
              {getStatusLabel(item.status)}
            </Text>
          </View>
        </View>

        <View style={styles.processorRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Text style={[styles.processorMeta, { color: colors.muted }]}>
              {getCollectionTypeLabel(item.collectionType)}
            </Text>
            {item.scheduledTime && (
              <Text style={[styles.processorMeta, { color: colors.muted }]}>
                ⏰ {item.scheduledTime}
              </Text>
            )}
          </View>

          {item.status === "pending" && (
            <TouchableOpacity
              onPress={() => handleMarkComplete(item)}
              style={[
                styles.processorActionButton,
                { backgroundColor: colors.success }
              ]}
            >
              <Text style={[styles.processorActionText, { color: "#0a0a0a" }]}>
                PROCESS
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {item.specialInstructions && (
          <View style={[styles.processorNote, { borderTopColor: colors.border }]}>
            <Text style={[styles.processorNoteText, { color: colors.muted }]}>
              ⚠️ {item.specialInstructions}
            </Text>
          </View>
        )}
      </NeonCard>
    </TouchableOpacity>
  );

  if (!route) {
    const scrollContent = (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.processorContainer, { padding: 16, paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {processorHeader}
      </ScrollView>
    );
    return (
      <ScreenContainer style={{ backgroundColor: colors.background }}>
        <ProcessorBackground />
        {Platform.OS !== "web" ? (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "translate-with-padding" : "padding"}
            keyboardVerticalOffset={0}
          >
            {scrollContent}
          </KeyboardAvoidingView>
        ) : (
          scrollContent
        )}
      </ScreenContainer>
    );
  }

  // Processing Queue only for VRP routes; OSM/Planner routes are navigation-only
  if (!isVrpRoute) {
    return (
      <ScreenContainer style={{ backgroundColor: colors.background }}>
        <ProcessorBackground />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {processorHeader}
          <NeonCard variant="cyan" padding={20}>
            <Text style={[styles.navOnlyText, { color: colors.muted }]}>
              This route is for navigation. Use the Map tab to drive it.
            </Text>
          </NeonCard>
        </ScrollView>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={{ backgroundColor: colors.background }}>
      <ProcessorBackground />
      <FlatList
        data={(route.points ?? []).slice(0, MAX_PROCESSING_QUEUE_DISPLAY)}
        renderItem={renderCollectionPoint}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View>
            {processorHeader}
            <NeoSectionHeader title="Processing Queue" />
            {(route.points?.length ?? 0) > MAX_PROCESSING_QUEUE_DISPLAY && (
              <Text style={[styles.truncatedNotice, { color: colors.muted }]}>
                Showing first {MAX_PROCESSING_QUEUE_DISPLAY} of {route.points?.length} stops. Use the Map tab to navigate and mark the rest.
              </Text>
            )}
          </View>
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  processorContainer: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  processorIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.15)',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  processorPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  processorText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    color: '#00D9FF',
  },
  processorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  processorIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.1)',
  },
  processorIconText: {
    fontSize: 20,
  },
  processorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
    color: '#00D9FF',
  },
  processorSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  processorHint: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  processorMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 217, 255, 0.1)',
  },
  processorMetric: {
    alignItems: 'center',
  },
  processorMetricLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  processorMetricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00D9FF',
  },
  processorProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  processorProgressFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
    backgroundColor: '#00D9FF',
  },
  processorPointAddress: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
    color: '#00D9FF',
  },
  processorPointLocation: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  processorStatusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.1)',
  },
  processorStatusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#00D9FF',
  },
  processorMeta: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  processorActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 217, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.4)',
    shadowColor: '#00D9FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  processorActionText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'white',
  },
  processorNote: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 217, 255, 0.1)',
  },
  processorNoteText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  truncatedNotice: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  navOnlyText: {
    fontSize: 14,
    lineHeight: 20,
  },
});