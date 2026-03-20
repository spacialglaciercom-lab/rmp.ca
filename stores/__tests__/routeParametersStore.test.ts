import { describe, it, expect, beforeEach, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(storage.get(k) ?? null),
    setItem: (k: string, v: string) => {
      storage.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      storage.delete(k);
      return Promise.resolve();
    },
    clear: () => {
      storage.clear();
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve([...storage.keys()]),
    multiGet: (keys: string[]) =>
      Promise.resolve(keys.map((k) => [k, storage.get(k) ?? null] as const)),
    multiSet: (pairs: [string, string][]) => {
      for (const [k, v] of pairs) storage.set(k, v);
      return Promise.resolve();
    },
  },
}));

import {
  useRouteParametersStore,
  getDeliveryParamsForRouting,
  getRouteOptionsForRouting,
} from "../routeParametersStore";

function resetToDefaults() {
  useRouteParametersStore.setState({
    allowPrivateAccess: false,
    goodsDelivery: false,
    fuelEfficientWay: false,
    considerTemporaryLimitations: true,
    voiceAssistanceEnabled: true,
    expoVoiceIndex: 0,
    offRouteAlertEnabled: false,
    recalcDistanceMeters: 120,
    recalcOnReverseDirection: true,
    avoidRoads: {
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
    },
  });
}

describe("routeParametersStore", () => {
  beforeEach(() => {
    storage.clear();
    resetToDefaults();
  });

  it("defaults recalcDistanceMeters to 120", () => {
    expect(useRouteParametersStore.getState().recalcDistanceMeters).toBe(120);
  });

  it("setRecalcDistanceMeters updates value", () => {
    useRouteParametersStore.getState().setRecalcDistanceMeters(200);
    expect(useRouteParametersStore.getState().recalcDistanceMeters).toBe(200);
  });

  it("setAvoidRoads updates a single key immutably", () => {
    useRouteParametersStore.getState().setAvoidRoads("noTollRoads", true);
    const a = useRouteParametersStore.getState().avoidRoads;
    expect(a.noTollRoads).toBe(true);
    expect(a.noMotorways).toBe(false);
  });

  it("setExpoVoiceIndex clamps to non-negative", () => {
    useRouteParametersStore.getState().setExpoVoiceIndex(-5);
    expect(useRouteParametersStore.getState().expoVoiceIndex).toBe(0);
    useRouteParametersStore.getState().setExpoVoiceIndex(3);
    expect(useRouteParametersStore.getState().expoVoiceIndex).toBe(3);
  });

  it("getDeliveryParamsForRouting uses default when goodsDelivery off", () => {
    useRouteParametersStore.setState({ goodsDelivery: false });
    const p = getDeliveryParamsForRouting();
    expect(p).toBeDefined();
    expect(typeof p).toBe("object");
  });

  it("getDeliveryParamsForRouting switches when goodsDelivery on", () => {
    useRouteParametersStore.setState({ goodsDelivery: false });
    const off = getDeliveryParamsForRouting();
    useRouteParametersStore.setState({ goodsDelivery: true });
    const on = getDeliveryParamsForRouting();
    expect(on).not.toEqual(off);
  });

  it("getRouteOptionsForRouting maps avoid flags to Google avoid array", () => {
    resetToDefaults();
    useRouteParametersStore.getState().setAvoidRoads("noTollRoads", true);
    useRouteParametersStore.getState().setAvoidRoads("noMotorways", true);
    useRouteParametersStore.getState().setAvoidRoads("noFerries", true);
    const { avoid } = getRouteOptionsForRouting();
    expect(avoid?.sort()).toEqual(["ferries", "highways", "tolls"].sort());
  });

  it("getRouteOptionsForRouting returns undefined avoid when none set", () => {
    resetToDefaults();
    const { avoid } = getRouteOptionsForRouting();
    expect(avoid).toBeUndefined();
  });
});
