/**
 * Power Saving Mode context and provider.
 * Manages battery-aware power modes for navigation to optimize battery life.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type PowerMode = "performance" | "balanced" | "ultra";

export const POWER_MODE_LABELS: Record<PowerMode, string> = {
  performance: "Performance",
  balanced: "Balanced",
  ultra: "Ultra Saver",
};

interface PowerSavingState {
  mode: PowerMode;
  autoSwitchEnabled: boolean;
}

interface PowerSavingContextValue {
  mode: PowerMode;
  state: PowerSavingState;
  batteryLevel: number;
  isReady: boolean;
  setMode: (mode: PowerMode) => void;
  setAutoSwitchEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = "trashroute_power_saving_state";

const DEFAULT_STATE: PowerSavingState = {
  mode: "balanced",
  autoSwitchEnabled: true,
};

const PowerSavingContext = createContext<PowerSavingContextValue | null>(null);

interface PowerSavingProviderProps {
  children: ReactNode;
}

export function PowerSavingProvider({ children }: PowerSavingProviderProps) {
  const [state, setState] = useState<PowerSavingState>(DEFAULT_STATE);
  const [batteryLevel, setBatteryLevel] = useState(1);
  const [isReady, setIsReady] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<PowerSavingState>;
          setState((prev) => ({
            ...prev,
            ...parsed,
          }));
        }
      } catch (e) {
        console.warn("Failed to load power saving state:", e);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // Monitor battery level (native only)
  useEffect(() => {
    if (Platform.OS === "web") {
      // Web Battery API (if available)
      if (typeof navigator !== "undefined" && "getBattery" in navigator) {
        (navigator as any).getBattery?.().then((battery: any) => {
          setBatteryLevel(battery.level ?? 1);
          const handleLevelChange = () => setBatteryLevel(battery.level ?? 1);
          battery.addEventListener?.("levelchange", handleLevelChange);
          return () => battery.removeEventListener?.("levelchange", handleLevelChange);
        }).catch(() => {});
      }
      return;
    }

    // Native: use expo-battery if available
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const Battery = await import("expo-battery");
        const level = await Battery.getBatteryLevelAsync();
        if (level >= 0) setBatteryLevel(level);
        
        const subscription = Battery.addBatteryLevelListener(({ batteryLevel: level }) => {
          if (level >= 0) setBatteryLevel(level);
        });
        unsubscribe = () => subscription.remove();
      } catch (e) {
        // expo-battery not available
      }
    })();

    return () => unsubscribe?.();
  }, []);

  // Auto-switch mode based on battery level
  useEffect(() => {
    if (!isReady || !state.autoSwitchEnabled) return;

    let newMode: PowerMode;
    if (batteryLevel > 0.3) {
      newMode = "performance";
    } else if (batteryLevel > 0.15) {
      newMode = "balanced";
    } else {
      newMode = "ultra";
    }

    if (newMode !== state.mode) {
      setState((prev) => ({ ...prev, mode: newMode }));
    }
  }, [batteryLevel, state.autoSwitchEnabled, isReady]);

  // Persist state changes
  const persistState = useCallback(async (newState: PowerSavingState) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    } catch (e) {
      console.warn("Failed to persist power saving state:", e);
    }
  }, []);

  const setMode = useCallback((mode: PowerMode) => {
    setState((prev) => {
      const newState = { ...prev, mode };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const setAutoSwitchEnabled = useCallback((enabled: boolean) => {
    setState((prev) => {
      const newState = { ...prev, autoSwitchEnabled: enabled };
      persistState(newState);
      return newState;
    });
  }, [persistState]);

  const value = useMemo<PowerSavingContextValue>(() => ({
    mode: state.mode,
    state,
    batteryLevel,
    isReady,
    setMode,
    setAutoSwitchEnabled,
  }), [state, batteryLevel, isReady, setMode, setAutoSwitchEnabled]);

  return React.createElement(PowerSavingContext.Provider, { value }, children);
}

export function usePowerSaving(): PowerSavingContextValue {
  const context = useContext(PowerSavingContext);
  if (!context) {
    throw new Error("usePowerSaving must be used within a PowerSavingProvider");
  }
  return context;
}
