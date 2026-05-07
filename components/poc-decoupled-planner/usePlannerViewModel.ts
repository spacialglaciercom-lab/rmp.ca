import { useState, useCallback } from "react";
import type { Route } from "@/types";

// The port: defining what our backend service should look like
export interface IPlannerBackend {
  optimizeRoute(coordinates: string, vehicles: number): Promise<Route | null>;
}

// The ViewModel state
export interface PlannerState {
  coordinates: string;
  vehicles: string;
  loading: boolean;
  error: string | null;
  result: Route | null;
}

// The ViewModel actions
export interface PlannerActions {
  setCoordinates: (val: string) => void;
  setVehicles: (val: string) => void;
  handleOptimize: () => Promise<void>;
  reset: () => void;
}

// The ViewModel Hook
export function usePlannerViewModel(backend: IPlannerBackend): PlannerState & PlannerActions {
  const [coordinates, setCoordinates] = useState("");
  const [vehicles, setVehicles] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Route | null>(null);

  const handleOptimize = useCallback(async () => {
    if (!coordinates) {
      setError("Coordinates are required");
      return;
    }

    const numVehicles = parseInt(vehicles, 10);
    if (isNaN(numVehicles) || numVehicles < 1) {
      setError("Vehicles must be a valid number >= 1");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const optimizedRoute = await backend.optimizeRoute(coordinates, numVehicles);
      setResult(optimizedRoute);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  }, [coordinates, vehicles, backend]);

  const reset = useCallback(() => {
    setCoordinates("");
    setVehicles("1");
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    coordinates,
    vehicles,
    loading,
    error,
    result,
    setCoordinates,
    setVehicles,
    handleOptimize,
    reset,
  };
}
