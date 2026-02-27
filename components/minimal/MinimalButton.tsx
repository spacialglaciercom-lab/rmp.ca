import { Text, TouchableOpacity, type TouchableOpacityProps } from "react-native";
import { useTheme } from "@/lib/theme-provider";

type Variant = "primary" | "secondary" | "dashed";

export function MinimalButton({
  title,
  variant = "primary",
  style,
  textStyle,
  ...props
}: TouchableOpacityProps & {
  title: string;
  variant?: Variant;
  textStyle?: object;
}) {
  const { theme } = useTheme();
  const isDark = theme.bg === "#0C0C0C";

  const bg =
    variant === "primary"
      ? theme.accent
      : variant === "dashed"
        ? theme.surfaceAlt
        : theme.surfaceAlt;
  const border = variant === "dashed" ? { borderWidth: 1.5, borderStyle: "dashed" as const, borderColor: theme.border } : variant === "secondary" ? { borderWidth: 1, borderColor: theme.border } : {};
  const color =
    variant === "primary"
      ? isDark ? "#0C0C0C" : "#fff"
      : theme.textSecondary;

  return (
    <TouchableOpacity
      style={[
        {
          backgroundColor: bg,
          borderRadius: variant === "primary" ? 12 : 10,
          paddingVertical: 16,
          paddingHorizontal: 20,
          alignItems: "center",
          justifyContent: "center",
          ...border,
        },
        style,
      ]}
      activeOpacity={0.8}
      {...props}
    >
      <Text style={[{ color, fontWeight: "500", fontSize: 15 }, textStyle]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}
