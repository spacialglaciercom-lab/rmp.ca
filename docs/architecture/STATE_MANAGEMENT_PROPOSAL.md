# UI and Backend Decoupling: State Management Refactoring Proposal

## Analysis of Current State
Currently, the codebase relies heavily on inline `useState` and `useEffect` within large components (e.g., `VRPPlanner.tsx` spans over 3,000 lines). Data fetching, local state (like input fields), domain logic (calculating VRP parameters), and UI rendering are tightly coupled. This makes components difficult to test in isolation, hard to maintain, and prone to performance issues due to excessive re-renders.

## Proposed Strategies

### Strategy 1: MVVM Pattern (Hooks-as-ViewModels)
**Concept**: Extract all state management, side effects, and data fetching into a dedicated custom hook (`use[Component]ViewModel`). The UI component only receives primitives and bound callback functions.
**Pros**: Highly idiomatic to React, easy to incrementally adopt, drastically simplifies the component tree.
**Cons**: Doesn't inherently enforce decoupling from backend services unless combined with Dependency Injection.

### Strategy 2: Finite State Machines (XState)
**Concept**: Model the component's states (e.g., idle, fetching, optimizing, error) using a strict finite state machine (FSM). The UI simply sends events to the machine and renders based on the current machine state.
**Pros**: Eliminates impossible states, makes complex workflows highly predictable and visualizable.
**Cons**: Steep learning curve, can be overkill for simpler components, adds new library dependencies.

### Strategy 3: Clean Architecture (Ports and Adapters)
**Concept**: Define strict TypeScript interfaces (Ports) for all backend and local storage operations. Implement these interfaces (Adapters) and inject them into the UI layer via React Context. The UI layer never imports backend logic directly.
**Pros**: Ultimate decoupling, maximum testability (can easily swap in mock adapters).
**Cons**: Heavy boilerplate, can slow down rapid prototyping.

## Selected Strategy: MVVM Pattern with Lightweight Dependency Injection
We will proceed with **Strategy 1 (MVVM)**, augmented with lightweight dependency injection for backend services.

By moving logic into a `ViewModel` hook and passing backend services (or stores) as arguments to that hook, we can achieve complete testability. The UI becomes a pure function of the ViewModel's return value.

## Proof of Concept
A new sandboxed branch `experimental/ui-decoupling-poc` has been created, containing a simplified, decoupled version of the VRPPlanner logic to demonstrate this architecture.
