import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface NeoSectionHeaderProps {
  title: string;
}

export function NeoSectionHeader({ title }: NeoSectionHeaderProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.line, { backgroundColor: colors.border }]} />
      <Text style={[styles.title, { color: colors.foreground }]}>
        {title.toUpperCase()}
      </Text>
      <View style={[styles.line, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
    gap: 12,
  },
  line: {
    flex: 1,
    height: 1,
    opacity: 0.6,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
