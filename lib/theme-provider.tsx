import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Appearance,
  View,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SchemeColors, type ColorScheme } from "@/shared/theme";
import {
  APP_THEME_STORAGE_KEY,
  darkTheme,
  lightTheme,
  type MinimalTheme,
} from "@/lib/minimal-theme";

type ThemeContextValue = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  /** Minimalist palette for Route OS UI (use this for all screens). */
  theme: MinimalTheme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialColorScheme(systemScheme: ColorScheme): ColorScheme {
  if (typeof window === "undefined" || typeof document === "undefined")
    return systemScheme;
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch (_) {}
  return systemScheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() ?? "light";
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() =>
    getInitialColorScheme(systemScheme),
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark") {
          setColorSchemeState(stored);
        }
      } catch (_) {}
      setHydrated(true);
    })();
  }, []);

  const applyScheme = useCallback((scheme: ColorScheme) => {
    try {
      nativewindColorScheme.set(scheme);
      Appearance.setColorScheme?.(scheme);
      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.dataset.theme = scheme;
        root.classList.toggle("dark", scheme === "dark");
        const palette = SchemeColors[scheme];
        Object.entries(palette).forEach(([token, value]) => {
          root.style.setProperty(`--color-${token}`, value);
        });
      }
    } catch (e) {
      if (__DEV__) console.warn("[ThemeProvider] applyScheme failed:", e);
    }
  }, []);

  const setColorScheme = useCallback(
    (scheme: ColorScheme) => {
      setColorSchemeState(scheme);
      applyScheme(scheme);
      AsyncStorage.setItem(APP_THEME_STORAGE_KEY, scheme).catch(() => {});
    },
    [applyScheme],
  );

  useEffect(() => {
    applyScheme(colorScheme);
  }, [applyScheme, colorScheme]);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": SchemeColors[colorScheme].primary,
        "color-background": SchemeColors[colorScheme].background,
        "color-surface": SchemeColors[colorScheme].surface,
        "color-surfaceElevated": SchemeColors[colorScheme].surfaceElevated,
        "color-foreground": SchemeColors[colorScheme].foreground,
        "color-muted": SchemeColors[colorScheme].muted,
        "color-border": SchemeColors[colorScheme].border,
        "color-success": SchemeColors[colorScheme].success,
        "color-warning": SchemeColors[colorScheme].warning,
        "color-error": SchemeColors[colorScheme].error,
        "color-accentCyan": SchemeColors[colorScheme].accentCyan,
        "color-accentMagenta": SchemeColors[colorScheme].accentMagenta,
        "color-statusRun": SchemeColors[colorScheme].statusRun,
      }),
    [colorScheme],
  );

  const theme = colorScheme === "dark" ? darkTheme : lightTheme;

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      theme,
    }),
    [colorScheme, setColorScheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}

/** Alias: returns theme palette, colorScheme, and setColorScheme. */
export function useTheme(): ThemeContextValue {
  return useThemeContext();
}
