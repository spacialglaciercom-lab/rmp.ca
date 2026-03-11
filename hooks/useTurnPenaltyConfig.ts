import { useState, useCallback, useMemo, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TurnPenalties } from "@/types/routing";

const STORAGE_KEY = "@trashroute:turn_penalty_config";

export type PresetName = "balanced" | "aggressive" | "minimal" | "custom";

export const PRESETS: Record<
  "balanced" | "aggressive" | "minimal",
  TurnPenalties
> = {
  balanced: { leftTurn: 60, uTurn: 95, rightTurn: 25 },
  aggressive: { leftTurn: 85, uTurn: 100, rightTurn: 45 },
  minimal: { leftTurn: 0, uTurn: 0, rightTurn: 0 },
};

const DEFAULT_CONFIG: TurnPenalties & { preset: PresetName } = {
  ...PRESETS.balanced,
  preset: "balanced",
};

export type TurnPenaltyConfig = TurnPenalties & { preset: PresetName };

export function findPresetName(penalties: TurnPenalties): PresetName {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (
      p.leftTurn === penalties.leftTurn &&
      p.uTurn === penalties.uTurn &&
      p.rightTurn === penalties.rightTurn
    ) {
      return name as "balanced" | "aggressive" | "minimal";
    }
  }
  return "custom";
}

function toConfig(
  penalties: TurnPenalties | TurnPenaltyConfig | null | undefined,
): TurnPenaltyConfig {
  if (!penalties) return DEFAULT_CONFIG;
  const p = {
    leftTurn: penalties.leftTurn,
    uTurn: penalties.uTurn,
    rightTurn: penalties.rightTurn,
  };
  const preset =
    "preset" in penalties && penalties.preset
      ? penalties.preset
      : findPresetName(p);
  return { ...p, preset };
}

export function useTurnPenaltyConfig(
  initialConfig?: TurnPenalties | TurnPenaltyConfig | null,
) {
  const [config, setConfig] = useState<TurnPenaltyConfig>(() =>
    toConfig(initialConfig ?? null),
  );
  const [appliedConfig, setAppliedConfig] = useState<TurnPenaltyConfig>(() =>
    toConfig(initialConfig ?? null),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load persisted config on mount (so we respect saved preference)
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) {
          if (!raw && initialConfig) {
            const next = toConfig(initialConfig);
            setConfig(next);
            setAppliedConfig(next);
          }
          setHydrated(true);
          return;
        }
        try {
          const parsed = JSON.parse(raw) as TurnPenalties;
          const preset = findPresetName(parsed);
          const next: TurnPenaltyConfig = { ...parsed, preset };
          if (!cancelled) {
            setConfig(next);
            setAppliedConfig(next);
          }
        } catch {
          // ignore
        }
        if (!cancelled) setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreset = useCallback(
    (presetName: "balanced" | "aggressive" | "minimal") => {
      const p = PRESETS[presetName];
      setConfig((prev) => ({ ...prev, ...p, preset: presetName }));
      setIsDirty(true);
    },
    [],
  );

  const updatePenalty = useCallback(
    (turnType: keyof TurnPenalties, value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      setConfig((prev) => ({
        ...prev,
        [turnType]: clamped,
        preset: "custom",
      }));
      setIsDirty(true);
    },
    [],
  );

  const applySettings = useCallback(() => {
    const toApply = { ...config };
    setAppliedConfig(toApply);
    setIsDirty(false);
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        leftTurn: toApply.leftTurn,
        uTurn: toApply.uTurn,
        rightTurn: toApply.rightTurn,
      }),
    ).catch(() => {});
    return {
      leftTurn: toApply.leftTurn,
      uTurn: toApply.uTurn,
      rightTurn: toApply.rightTurn,
    };
  }, [config]);

  const resetSettings = useCallback(() => {
    setConfig(appliedConfig);
    setIsDirty(false);
  }, [appliedConfig]);

  const priorityOrder = useMemo(() => {
    const entries: Array<{
      type: "right" | "left" | "uturn";
      penalty: number;
    }> = [
      { type: "right", penalty: config.rightTurn },
      { type: "left", penalty: config.leftTurn },
      { type: "uturn", penalty: config.uTurn },
    ];
    return entries.sort((a, b) => a.penalty - b.penalty).map((e) => e.type);
  }, [config.rightTurn, config.leftTurn, config.uTurn]);

  return {
    config,
    appliedConfig,
    isDirty,
    priorityOrder,
    setPreset,
    updatePenalty,
    applySettings,
    resetSettings,
    presets: ["balanced", "aggressive", "minimal"] as const,
    hydrated,
  };
}
