import { View, Text, StyleSheet, Platform } from "react-native";

import { useColors } from "@/hooks/use-colors";

export interface NeoHeaderProps {
  /** Main title, e.g. "NEO DELIVERY // ROUTE OS" */
  title?: string;
  /** Status line, e.g. "TODAY'S RUN" */
  statusLabel?: string;
  /** Subtitle / status value, e.g. "No active route" */
  subtitle?: string;
  /** Use orange/red for status (today's run) */
  statusHighlight?: boolean;
}

const DEFAULT_TITLE = "NEO DELIVERY // ROUTE OS";
const DEFAULT_STATUS = "TODAY'S RUN";
const DEFAULT_SUBTITLE = "No active route";

export function NeoHeader({
  title = DEFAULT_TITLE,
  statusLabel = DEFAULT_STATUS,
  subtitle = DEFAULT_SUBTITLE,
  statusHighlight = true,
}: NeoHeaderProps) {
  const colors = useColors();
  const statusColor = statusHighlight
    ? (colors.statusRun ?? colors.warning)
    : colors.primary;

  return (
    <View style={styles.wrap}>
      <Text
        style={[styles.title, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      <View style={styles.statusRow}>
        <Text style={[styles.statusLabel, { color: statusColor }]}>
          {statusLabel}
        </Text>
      </View>
      <Text
        style={[styles.subtitle, { color: colors.muted }]}
        numberOfLines={1}
      >
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 24,
    padding: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 255, 0.15)",
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 2px 8px rgba(0, 217, 255, 0.2)" }
      : {
          shadowColor: "#00D9FF",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 8,
          elevation: 4,
        }),
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#00D9FF",
    ...(Platform.OS === "web"
      ? { textShadow: "0px 2px 4px rgba(0, 217, 255, 0.5)" }
      : {
          textShadowColor: "rgba(0, 217, 255, 0.5)",
          textShadowOffset: { width: 0, height: 2 },
          textShadowRadius: 4,
        }),
  },
  statusRow: {
    marginTop: 6,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#00D9FF",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    color: "rgba(255, 255, 255, 0.7)",
  },
});
