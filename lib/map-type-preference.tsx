/**
 * Map type preference: Standard (default) or Dark (Radar-style dark monochrome).
 * Persisted in AsyncStorage; shared via React Context so Settings and Map stay in sync.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "@trashroute:map_type";

export type MapTypePreference = "standard" | "dark";

const DEFAULT: MapTypePreference = "standard";

export async function getStoredMapType(): Promise<MapTypePreference> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    if (value === "dark" || value === "standard") return value;
  } catch {
    // ignore
  }
  return DEFAULT;
}

export async function setStoredMapType(
  value: MapTypePreference,
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

type MapTypeContextValue = [
  MapTypePreference,
  (value: MapTypePreference) => Promise<void>,
];
const MapTypeContext = React.createContext<MapTypeContextValue | null>(null);

export function MapTypeProvider({ children }: { children: React.ReactNode }) {
  const [mapType, setMapTypeState] = useState<MapTypePreference>(DEFAULT);

  useEffect(() => {
    getStoredMapType().then(setMapTypeState);
  }, []);

  const setMapType = useCallback(async (value: MapTypePreference) => {
    await setStoredMapType(value);
    setMapTypeState(value);
  }, []);

  return (
    <MapTypeContext.Provider value={[mapType, setMapType]}>
      {children}
    </MapTypeContext.Provider>
  );
}

export function useMapType(): [
  MapTypePreference,
  (value: MapTypePreference) => Promise<void>,
] {
  const ctx = useContext(MapTypeContext);
  if (ctx) return ctx;

  const [mapType, setMapTypeState] = useState<MapTypePreference>(DEFAULT);
  useEffect(() => {
    getStoredMapType().then(setMapTypeState);
  }, []);
  const setMapType = useCallback(async (value: MapTypePreference) => {
    await setStoredMapType(value);
    setMapTypeState(value);
  }, []);
  return [mapType, setMapType];
}

/** Label for UI (e.g. Settings) */
export function mapTypeLabel(value: MapTypePreference): string {
  return value === "dark" ? "Dark" : "Standard";
}
