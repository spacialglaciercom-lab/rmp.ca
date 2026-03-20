import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using clsx and tailwind-merge.
 * This ensures Tailwind classes are properly merged without conflicts.
 *
 * Usage:
 * ```tsx
 * cn("px-4 py-2", isActive && "bg-primary", className)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a unique route ID to avoid AsyncStorage key collision and
 * "Route #1 takes place of #2" bugs. Uses crypto.randomUUID when available,
 * otherwise timestamp + random suffix (no extra dependencies).
 */
export function generateRouteId(): string {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).crypto?.randomUUID === "function"
  ) {
    return `route_${(globalThis as any).crypto.randomUUID()}`;
  }
  return `route_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
