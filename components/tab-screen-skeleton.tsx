import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

export interface TabScreenSkeletonProps {
  title: string;
  subtitle?: string;
}

/**
 * Minimal skeleton shown while a lazy-loaded tab screen is loading.
 * Used as Suspense fallback for Planner, Map, and Settings tabs (Phase 1.1).
 */
export function TabScreenSkeleton({ title, subtitle }: TabScreenSkeletonProps) {
  const colors = useColors();
  return (
    <ScreenContainer style={{ backgroundColor: colors.background }}>
      <View style={styles.outer}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {subtitle}
          </Text>
        ) : null}
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={styles.spinner}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: "center",
  },
  spinner: {
    marginTop: 8,
  },
});
