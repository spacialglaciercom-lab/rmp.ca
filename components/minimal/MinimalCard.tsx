import { View, type ViewProps } from "react-native";
import { useTheme } from "@/lib/theme-provider";

export function MinimalCard({ style, ...props }: ViewProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.border,
          paddingVertical: 4,
          paddingHorizontal: 20,
        },
        style,
      ]}
      {...props}
    />
  );
}
