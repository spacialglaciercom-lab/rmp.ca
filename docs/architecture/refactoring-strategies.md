# Refactoring Strategies for Decoupling UI from Backend Logic

## Analysis of Current State
Currently, the codebase uses a mix of state management and data fetching approaches:
1. **Zustand Stores**: Found in `stores/` (e.g., `mapStateStore.ts`, `routeParametersStore.ts`). These manage client-side state but are sometimes tightly coupled with logic.
2. **Context API**: e.g., `lib/routing-context.tsx`, which contains complex routing state and logic (`generateLogEntry`, `validateCoordinates`).
3. **WatermelonDB Hooks**: Found in `lib/database/hooks/` (e.g., `useRoutes.ts`, `useCollectionPoints.ts`, `useDatabase.ts`). These provide offline-first reactive updates.
4. **React Query / Custom Hooks**: e.g., `useRouteOptimization.ts` which handles complex logic like calling backend services, managing state, and triggering analytics.
5. **Component-level State**: Complex components like `planner-content.tsx` and `start-point-config.tsx` directly call hooks that manage global state and backend interactions, making them difficult to test in isolation.

## Goal
Improve maintainability and testability by completely decoupling the UI from the backend logic.

## Proposed Strategies

### Strategy 1: Container/Presenter Pattern with Custom Hooks
Separate components into "Containers" (Smart) and "Presenters" (Dumb).
- **Presenters**: Pure UI components that receive data and callbacks via props. No knowledge of Zustand, WatermelonDB, or external APIs.
- **Containers**: Wrappers that use existing hooks (`useRouting`, `useRouteOptimization`, `useRoutesActions`) and pass state down to Presenters.
- **Pros**: Easy to implement incrementally. Immediately makes UI components testable.
- **Cons**: Doesn't fix the underlying complexity of the hooks themselves.

### Strategy 2: ViewModel/Controller Architecture (MVC/MVVM)
Introduce a ViewModel layer that abstracts all data fetching and state manipulation.
- **ViewModels**: Classes or custom hooks that encapsulate all business logic, orchestrating calls between WatermelonDB, Zustand, and backend APIs. They expose clean interfaces to the UI.
- **UI**: Components only interact with ViewModels, observing state and calling methods.
- **Pros**: Strong separation of concerns. Centralizes business logic making it easier to test.
- **Cons**: Requires rewriting significant portions of the application logic. Can introduce boilerplate.

### Strategy 3: Command Pattern with Redux/Zustand Action Dispatchers
Decouple UI actions from logic execution using a command/event bus pattern.
- **UI**: Dispatches abstract events/actions (e.g., `dispatch({ type: 'OPTIMIZE_ROUTE', payload: {...} })`).
- **Middleware/Sagas/Thunks**: Intercept actions, perform side effects (API calls, DB reads/writes), and update the store.
- **State**: UI purely subscribes to a simplified state tree.
- **Pros**: Highly testable. Excellent for complex async workflows (like route optimization).
- **Cons**: High initial setup cost. Can be overly complex for simple CRUD operations.

## Selected Strategy: Strategy 1 (Container/Presenter Pattern)
For the experimental proof-of-concept, Strategy 1 is the most pragmatic. It provides immediate benefits to UI testability without requiring a complete rewrite of the existing complex hooks (`useRouteOptimization`, `useRouting`). We will apply this to `StartPointConfig`.
