# shared-logic (KMP)

Kotlin Multiplatform module containing CVRP/CPP math. Used by:

- **Web / Expo / Vercel:** Default `package.json` uses `file:./shared-logic/pnpm-stub` (empty stub) so `pnpm install` works without Gradle. To enable the **KMP solver**, build JS (see below) then run: `pnpm add shared-logic@file:./shared-logic/build/js/packages/shared-logic`. The Kotlin/JS export is `sharedlogic.SharedLogicBridge`; the app resolves it in `lib/vrp-solvers/kmp.ts`.
- **Android:** Add as Gradle dependency: `implementation(project(":shared-logic"))`.
- **iOS:** (Optional) Add `iosArm64()` / `iosSimulatorArm64()` targets and XCFramework output, then link from Swift.

## Build (the real thing)

Requires **JDK 17**. From repo root:

```bash
./gradlew :shared-logic:assemble
```

Or: `pnpm run build:shared-logic`

JS output: `shared-logic/build/js/packages/shared-logic/` (npm-compatible package). After the build, point the dependency at it: `pnpm add shared-logic@file:./shared-logic/build/js/packages/shared-logic`, then restart Metro/Expo.

## React integration

In `lib/vrp-solvers/`, add a solver that delegates to the Kotlin bridge:

```ts
import type { VRPSolver, VRPSolverInput, VRPSolverOutput } from "./types";

declare const SharedLogicBridge: {
  solveCvrp(
    locations: Array<{ lat: number; lon: number; label: string }>,
    numVehicles: number,
    matrix: Array<Array<{ distance: number; time: number }>>
  ): { stops: typeof locations; routes: typeof locations[]; totalDistanceKm: string; totalTimeMin: number };
};

export const kmpSolver: VRPSolver = {
  id: "kmp",
  label: "KMP (Clarke-Wright)",
  requiresMatrix: true,
  async solve(input: VRPSolverInput): Promise<VRPSolverOutput> {
    const result = SharedLogicBridge.solveCvrp(
      input.locations,
      input.numVehicles,
      input.matrix!
    );
    return {
      stops: result.stops,
      routes: result.routes,
      totalDistanceKm: result.totalDistanceKm,
      totalTimeMin: result.totalTimeMin,
    };
  },
};
```

Register `kmpSolver` in `VRP_SOLVER_LIST` in `lib/vrp-solvers/index.ts`.
