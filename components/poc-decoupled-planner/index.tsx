import React from "react";
import { DecoupledPlannerView } from "./DecoupledPlannerView";
import { usePlannerViewModel, type IPlannerBackend } from "./usePlannerViewModel";

// Mock Implementation of the Backend for demonstration purposes
class MockPlannerBackend implements IPlannerBackend {
  async optimizeRoute(coordinates: string, vehicles: number): Promise<any> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Simulate error condition
    if (coordinates.includes("error")) {
      throw new Error("Simulated network or solving error");
    }

    // Return dummy data matching the Route type shape loosely
    return {
      id: `route_${Date.now()}`,
      totalDistanceMeters: Math.floor(Math.random() * 10000) + 1000,
      coordinates: coordinates.split(";"),
      vehiclesAllocated: vehicles
    };
  }
}

// In a real application, this backend instance would be provided via Context (Dependency Injection)
const defaultBackend = new MockPlannerBackend();

export default function DecoupledPlannerScreen() {
  // 1. Initialize ViewModel with the specific backend adapter
  const viewModel = usePlannerViewModel(defaultBackend);

  // 2. Pass State & Actions to the pure UI component
  return <DecoupledPlannerView {...viewModel} />;
}
