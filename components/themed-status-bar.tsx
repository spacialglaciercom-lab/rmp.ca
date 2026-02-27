import { StatusBar } from "expo-status-bar";
import { useTheme } from "@/lib/theme-provider";

export function ThemedStatusBar() {
  const { colorScheme } = useTheme();
  return (
    <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
  );
}
