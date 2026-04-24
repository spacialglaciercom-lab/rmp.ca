import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  useRouteParametersStore,
  getDeliveryParamsForRouting,
  getRouteOptionsForRouting,
} from '../routeParametersStore';

const defaultAvoidRoads = {
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

beforeEach(() => {
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
    avoidRoads: { ...defaultAvoidRoads },
  });
});

describe('defaults', () => {
  it('recalcDistanceMeters is 120', () => {
    expect(useRouteParametersStore.getState().recalcDistanceMeters).toBe(120);
  });
  it('voiceAssistanceEnabled is true', () => {
    expect(useRouteParametersStore.getState().voiceAssistanceEnabled).toBe(true);
  });
  it('goodsDelivery is false', () => {
    expect(useRouteParametersStore.getState().goodsDelivery).toBe(false);
  });
  it('offRouteAlertEnabled is false', () => {
    expect(useRouteParametersStore.getState().offRouteAlertEnabled).toBe(false);
  });
  it('all avoidRoads flags are false', () => {
    const { avoidRoads } = useRouteParametersStore.getState();
    expect(Object.values(avoidRoads).every((v) => v === false)).toBe(true);
  });
});

describe('setters', () => {
  it('setRecalcDistanceMeters updates value', () => {
    useRouteParametersStore.getState().setRecalcDistanceMeters(200);
    expect(useRouteParametersStore.getState().recalcDistanceMeters).toBe(200);
  });
  it('setVoiceAssistanceEnabled updates value', () => {
    useRouteParametersStore.getState().setVoiceAssistanceEnabled(false);
    expect(useRouteParametersStore.getState().voiceAssistanceEnabled).toBe(false);
  });
  it('setGoodsDelivery updates value', () => {
    useRouteParametersStore.getState().setGoodsDelivery(true);
    expect(useRouteParametersStore.getState().goodsDelivery).toBe(true);
  });
  it('setAllowPrivateAccess updates value', () => {
    useRouteParametersStore.getState().setAllowPrivateAccess(true);
    expect(useRouteParametersStore.getState().allowPrivateAccess).toBe(true);
  });
  it('setFuelEfficientWay updates value', () => {
    useRouteParametersStore.getState().setFuelEfficientWay(true);
    expect(useRouteParametersStore.getState().fuelEfficientWay).toBe(true);
  });
  it('setOffRouteAlertEnabled updates value', () => {
    useRouteParametersStore.getState().setOffRouteAlertEnabled(true);
    expect(useRouteParametersStore.getState().offRouteAlertEnabled).toBe(true);
  });
  it('setRecalcOnReverseDirection updates value', () => {
    useRouteParametersStore.getState().setRecalcOnReverseDirection(false);
    expect(useRouteParametersStore.getState().recalcOnReverseDirection).toBe(false);
  });
  it('setExpoVoiceIndex clamps negative input to 0', () => {
    useRouteParametersStore.getState().setExpoVoiceIndex(-5);
    expect(useRouteParametersStore.getState().expoVoiceIndex).toBe(0);
  });
  it('setExpoVoiceIndex accepts positive values', () => {
    useRouteParametersStore.getState().setExpoVoiceIndex(3);
    expect(useRouteParametersStore.getState().expoVoiceIndex).toBe(3);
  });
});

describe('setAvoidRoads', () => {
  it('patches a single avoidRoads flag', () => {
    useRouteParametersStore.getState().setAvoidRoads('noTollRoads', true);
    expect(useRouteParametersStore.getState().avoidRoads.noTollRoads).toBe(true);
  });

  it('leaves other avoidRoads flags unchanged', () => {
    useRouteParametersStore.getState().setAvoidRoads('noTollRoads', true);
    expect(useRouteParametersStore.getState().avoidRoads.noFerries).toBe(false);
  });

  it('can update multiple flags independently', () => {
    useRouteParametersStore.getState().setAvoidRoads('noTollRoads', true);
    useRouteParametersStore.getState().setAvoidRoads('noMotorways', true);
    const { avoidRoads } = useRouteParametersStore.getState();
    expect(avoidRoads.noTollRoads).toBe(true);
    expect(avoidRoads.noMotorways).toBe(true);
    expect(avoidRoads.noFerries).toBe(false);
  });
});

describe('hydrate', () => {
  it('is a no-op and does not throw', () => {
    expect(() => useRouteParametersStore.getState().hydrate()).not.toThrow();
  });
});

describe('getDeliveryParamsForRouting', () => {
  it('returns an object when goodsDelivery is false', () => {
    expect(getDeliveryParamsForRouting()).toBeTypeOf('object');
  });

  it('returns an object when goodsDelivery is true', () => {
    useRouteParametersStore.setState({ goodsDelivery: true });
    expect(getDeliveryParamsForRouting()).toBeTypeOf('object');
  });

  it('returns different params depending on goodsDelivery', () => {
    useRouteParametersStore.setState({ goodsDelivery: false });
    const normal = getDeliveryParamsForRouting();
    useRouteParametersStore.setState({ goodsDelivery: true });
    const delivery = getDeliveryParamsForRouting();
    expect(normal).not.toEqual(delivery);
  });
});

describe('getRouteOptionsForRouting', () => {
  it('returns undefined avoid when no road restrictions are active', () => {
    expect(getRouteOptionsForRouting().avoid).toBeUndefined();
  });

  it('includes "tolls" when noTollRoads is true', () => {
    useRouteParametersStore.getState().setAvoidRoads('noTollRoads', true);
    expect(getRouteOptionsForRouting().avoid).toContain('tolls');
  });

  it('includes "highways" when noMotorways is true', () => {
    useRouteParametersStore.getState().setAvoidRoads('noMotorways', true);
    expect(getRouteOptionsForRouting().avoid).toContain('highways');
  });

  it('includes "ferries" when noFerries is true', () => {
    useRouteParametersStore.getState().setAvoidRoads('noFerries', true);
    expect(getRouteOptionsForRouting().avoid).toContain('ferries');
  });

  it('can combine multiple avoid types', () => {
    useRouteParametersStore.getState().setAvoidRoads('noTollRoads', true);
    useRouteParametersStore.getState().setAvoidRoads('noFerries', true);
    const { avoid } = getRouteOptionsForRouting();
    expect(avoid).toContain('tolls');
    expect(avoid).toContain('ferries');
  });

  it('always includes deliveryParams', () => {
    expect(getRouteOptionsForRouting().deliveryParams).toBeDefined();
  });
});
