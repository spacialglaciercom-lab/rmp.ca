import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTheme } from "@/lib/theme-provider";

interface SectionLabelProps {
  children: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function SectionLabel({ children, color, style }: SectionLabelProps) {
  const { theme } = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: 12,
          fontWeight: "600",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: color ?? theme.textTertiary,
          marginTop: 28,
          marginBottom: 8,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
