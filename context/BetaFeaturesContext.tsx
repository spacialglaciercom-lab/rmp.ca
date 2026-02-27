import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BetaFeatures } from "@/types/turnAware";
import { createLogger } from "@/lib/logger";

const log = createLogger("BetaFeatures");

interface BetaContextType {
  features: BetaFeatures;
  enableBeta: () => Promise<void>;
  disableBeta: () => Promise<void>;
  toggleTurnAware: (enabled: boolean) => Promise<void>;
  toggleLearnedPenalties: (enabled: boolean) => Promise<void>;
  toggleWeatherOptimizedRouting: (enabled: boolean) => Promise<void>;
  toggleVoiceCoPilot: (enabled: boolean) => Promise<void>;
  toggleRouteMasterConstraints: (enabled: boolean) => Promise<void>;
  recordCrash: () => Promise<void>; // safety mechanism
  isExperimentalRoute: boolean;
}

const BetaContext = createContext<BetaContextType | undefined>(undefined);
const STORAGE_KEY = "@beta_features";

export const BetaFeaturesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [features, setFeatures] = useState<BetaFeatures>({
    enabled: false,
    turnAwareCpp: false,
    learnedPenalties: false,
    weatherOptimizedRouting: false,
    voiceCoPilot: false,
    routeMasterConstraints: false,
    crashCount: 0,
  });

  useEffect(() => {
    loadFeatures();
  }, []);

  const loadFeatures = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<BetaFeatures>;
        setFeatures({
          enabled: parsed.enabled ?? false,
          turnAwareCpp: parsed.turnAwareCpp ?? false,
          learnedPenalties: parsed.learnedPenalties ?? false,
          weatherOptimizedRouting: parsed.weatherOptimizedRouting ?? false,
          voiceCoPilot: parsed.voiceCoPilot ?? false,
          routeMasterConstraints: parsed.routeMasterConstraints ?? false,
          crashCount: parsed.crashCount ?? 0,
        });
      }
    } catch (e) {
      log.error("Failed to load beta features", e instanceof Error ? e : new Error(String(e)));
    }
  };

  const saveFeatures = async (newFeatures: BetaFeatures) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newFeatures));
    setFeatures(newFeatures);
  };

  const enableBeta = async () => {
    // Reset crash counter when user explicitly re-enables beta
    await saveFeatures({ ...features, enabled: true, crashCount: 0 });
  };

  const disableBeta = async () => {
    await saveFeatures({
      enabled: false,
      turnAwareCpp: false,
      learnedPenalties: false,
      weatherOptimizedRouting: false,
      voiceCoPilot: false,
      routeMasterConstraints: false,
      crashCount: 0,
    });
  };

  const toggleTurnAware = async (enabled: boolean) => {
    if (!features.enabled) return;
    await saveFeatures({ ...features, turnAwareCpp: enabled });
  };

  const toggleLearnedPenalties = async (enabled: boolean) => {
    if (!features.enabled) return;
    await saveFeatures({ ...features, learnedPenalties: enabled });
  };

  const toggleWeatherOptimizedRouting = async (enabled: boolean) => {
    if (!features.enabled) return;
    await saveFeatures({ ...features, weatherOptimizedRouting: enabled });
  };

  const toggleVoiceCoPilot = async (enabled: boolean) => {
    if (!features.enabled) return;
    await saveFeatures({ ...features, voiceCoPilot: enabled });
  };

  const toggleRouteMasterConstraints = async (enabled: boolean) => {
    if (!features.enabled) return;
    await saveFeatures({ ...features, routeMasterConstraints: enabled });
  };

  const recordCrash = async () => {
    const newCrashCount = features.crashCount + 1;
    if (newCrashCount >= 2) {
      // Auto-disable after 2 crashes
      await disableBeta();
      await AsyncStorage.setItem("@beta_disabled_reason", "safety_circuit_breaker");
    } else {
      await saveFeatures({ ...features, crashCount: newCrashCount });
    }
  };

  const isExperimental = features.enabled && features.turnAwareCpp;
  useEffect(() => {
    log.debug("state", {
      enabled: features.enabled,
      turnAwareCpp: features.turnAwareCpp,
      crashCount: features.crashCount,
      isExperimentalRoute: isExperimental,
    });
  }, [features, isExperimental]);

  return (
    <BetaContext.Provider
      value={{
        features,
        enableBeta,
        disableBeta,
        toggleTurnAware,
        toggleLearnedPenalties,
        toggleWeatherOptimizedRouting,
        toggleVoiceCoPilot,
        toggleRouteMasterConstraints,
        recordCrash,
        isExperimentalRoute: isExperimental,
      }}
    >
      {children}
    </BetaContext.Provider>
  );
};

export const useBetaFeatures = () => {
  const context = useContext(BetaContext);
  if (!context) throw new Error("useBetaFeatures must be used within BetaFeaturesProvider");
  return context;
};
