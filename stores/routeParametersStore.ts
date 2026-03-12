import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DeliveryRouteParams } from "@/types/routeParams";
import { defaultDeliveryParams, deliveryModeParams } from "@/types/routeParams";

export const RECALC_DISTANCE_OPTIONS = [
  { value: 50, label: "50 m" },
  { value: 80, label: "80 m" },
  { value: 120, label: "120 m" },
  { value: 200, label: "200 m" },
  { value: 300, label: "300 m" },
] as const;

export type RecalcDistanceValue =
  (typeof RECALC_DISTANCE_OPTIONS)[number]["value"];

/** Avoid-by-type options (match "Avoid roads..." sub-screen). */
export interface AvoidRoadsState {
  noTollRoads: boolean;
  avoidLowEmissionZones: boolean;
  noShuttleTrain: boolean;
  noBorderCrossings: boolean;
  noIceRoadsOrFords: boolean;
  noMotorways: boolean;
  avoid4WDRoads: boolean;
  noFerries: boolean;
  avoidTunnels: boolean;
  noUnpavedRoads: boolean;
}

const defaultAvoidRoads: AvoidRoadsState = {
  noTollRoads: false,
  avoidLowEmissionZones: false,
  noShuttleTrain: false,
  noBorderCrossings: false,
  noIceRoadsOrFords: false,
  noMotorways: false,
  avoid4WDRoads: false,
  noFerries: false,
  avoidTunnels: false,
  noUnpavedRoads: false,
};

export interface RouteParametersState {
  allowPrivateAccess: boolean;
  goodsDelivery: boolean;
  fuelEfficientWay: boolean;
  considerTemporaryLimitations: boolean;
  voiceAssistanceEnabled: boolean;
  /** Index into Speech.getAvailableVoicesAsync() for navigation and system TTS fallback. */
  expoVoiceIndex: number;
  /** Show "You're off the optimized route" banner during navigation. */
  offRouteAlertEnabled: boolean;
  recalcDistanceMeters: RecalcDistanceValue;
  recalcOnReverseDirection: boolean;
  avoidRoads: AvoidRoadsState;
}

const defaultState: RouteParametersState = {
  allowPrivateAccess: false,
  goodsDelivery: false,
  fuelEfficientWay: false,
  considerTemporaryLimitations: true,
  voiceAssistanceEnabled: true,
  expoVoiceIndex: 0,
  offRouteAlertEnabled: false,
  recalcDistanceMeters: 120,
  recalcOnReverseDirection: true,
  avoidRoads: defaultAvoidRoads,
};

interface RouteParametersStore extends RouteParametersState {
  setAllowPrivateAccess: (v: boolean) => void;
  setGoodsDelivery: (v: boolean) => void;
  setFuelEfficientWay: (v: boolean) => void;
  setConsiderTemporaryLimitations: (v: boolean) => void;
  setVoiceAssistanceEnabled: (v: boolean) => void;
  setExpoVoiceIndex: (v: number) => void;
  setOffRouteAlertEnabled: (v: boolean) => void;
  setRecalcDistanceMeters: (v: RecalcDistanceValue) => void;
  setRecalcOnReverseDirection: (v: boolean) => void;
  setAvoidRoads: (key: keyof AvoidRoadsState, value: boolean) => void;
  /** @deprecated No longer needed -- store auto-hydrates via Zustand persist middleware */
  hydrate: () => Promise<void>;
  /** @deprecated No longer needed -- store auto-persists via Zustand persist middleware */
  persist: () => void;
}

export const useRouteParametersStore = create<RouteParametersStore>()(
  persist(
    (set) => ({
      ...defaultState,

      setAllowPrivateAccess: (v) => set({ allowPrivateAccess: v }),
      setGoodsDelivery: (v) => set({ goodsDelivery: v }),
      setFuelEfficientWay: (v) => set({ fuelEfficientWay: v }),
      setConsiderTemporaryLimitations: (v) =>
        set({ considerTemporaryLimitations: v }),
      setVoiceAssistanceEnabled: (v) => set({ voiceAssistanceEnabled: v }),
      setExpoVoiceIndex: (v) => set({ expoVoiceIndex: Math.max(0, v) }),
      setOffRouteAlertEnabled: (v) => set({ offRouteAlertEnabled: v }),
      setRecalcDistanceMeters: (v) => set({ recalcDistanceMeters: v }),
      setRecalcOnReverseDirection: (v) => set({ recalcOnReverseDirection: v }),
      setAvoidRoads: (key, value) =>
        set((s) => ({ avoidRoads: { ...s.avoidRoads, [key]: value } })),

      // Backward-compat stubs: no-ops since persist middleware handles hydration/persistence
      hydrate: async () => {},
      persist: () => {},
    }),
    {
      name: "trashroute_route_parameters",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        allowPrivateAccess: s.allowPrivateAccess,
        goodsDelivery: s.goodsDelivery,
        fuelEfficientWay: s.fuelEfficientWay,
        considerTemporaryLimitations: s.considerTemporaryLimitations,
        voiceAssistanceEnabled: s.voiceAssistanceEnabled,
        expoVoiceIndex: s.expoVoiceIndex,
        offRouteAlertEnabled: s.offRouteAlertEnabled,
        recalcDistanceMeters: s.recalcDistanceMeters,
        recalcOnReverseDirection: s.recalcOnReverseDirection,
        avoidRoads: s.avoidRoads,
      }),
      // Merge persisted partial state with defaults to handle added/removed fields gracefully
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<RouteParametersState>),
        avoidRoads: {
          ...defaultAvoidRoads,
          ...((persisted as Partial<RouteParametersState>)?.avoidRoads ?? {}),
        },
      }),
    },
  ),
);

/** Build DeliveryRouteParams from current store state (goods delivery toggle + defaults). */
export function getDeliveryParamsForRouting(): DeliveryRouteParams {
  const state = useRouteParametersStore.getState();
  if (state.goodsDelivery) {
    return { ...deliveryModeParams };
  }
  return { ...defaultDeliveryParams };
}

/** Build RouteOptions for mapMatching from current store state (avoid tolls, highways, ferries; delivery params). */
export function getRouteOptionsForRouting(): {
  avoid?: ("tolls" | "highways" | "ferries")[];
  deliveryParams: DeliveryRouteParams;
} {
  const state = useRouteParametersStore.getState();
  const a = state.avoidRoads;
  const avoid: ("tolls" | "highways" | "ferries")[] = [];
  if (a.noTollRoads) avoid.push("tolls");
  if (a.noMotorways) avoid.push("highways");
  if (a.noFerries) avoid.push("ferries");

  return {
    avoid: avoid.length ? avoid : undefined,
    deliveryParams: getDeliveryParamsForRouting(),
  };
}
