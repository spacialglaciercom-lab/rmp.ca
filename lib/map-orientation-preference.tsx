/**
 * Map orientation preference: North up, direction of movement, or compass.
 * Persisted in AsyncStorage; shared via React Context.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "@trashroute:map_orientation";

export type MapOrientation = "north" | "course" | "compass";

const DEFAULT: MapOrientation = "north";

export async function getStoredMapOrientation(): Promise<MapOrientation> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    if (value === "north" || value === "course" || value === "compass") return value;
  } catch {
    // ignore
  }
  return DEFAULT;
}

export async function setStoredMapOrientation(value: MapOrientation): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

type MapOrientationContextValue = [MapOrientation, (value: MapOrientation) => Promise<void>];
const MapOrientationContext = React.createContext<MapOrientationContextValue | null>(null);

export function MapOrientationProvider({ children }: { children: React.ReactNode }) {
  const [orientation, setOrientationState] = useState<MapOrientation>(DEFAULT);

  useEffect(() => {
    getStoredMapOrientation().then(setOrientationState);
  }, []);

  const setOrientation = useCallback(async (value: MapOrientation) => {
    await setStoredMapOrientation(value);
    setOrientationState(value);
  }, []);

  return (
    <MapOrientationContext.Provider value={[orientation, setOrientation]}>
      {children}
    </MapOrientationContext.Provider>
  );
}

export function useMapOrientation(): [MapOrientation, (value: MapOrientation) => Promise<void>] {
  const ctx = useContext(MapOrientationContext);
  if (ctx) return ctx;

  const [orientation, setOrientationState] = useState<MapOrientation>(DEFAULT);
  useEffect(() => {
    getStoredMapOrientation().then(setOrientationState);
  }, []);
  const setOrientation = useCallback(async (value: MapOrientation) => {
    await setStoredMapOrientation(value);
    setOrientationState(value);
  }, []);
  return [orientation, setOrientation];
}

/** Labels for UI */
export const MAP_ORIENTATION_LABELS: Record<MapOrientation, string> = {
  north: "Do not rotate (north is up)",
  course: "To direction of movement",
  compass: "To compass",
};
