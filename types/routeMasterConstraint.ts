/**
 * RouteMaster PRO — Constraint types for natural language → structured rule parsing.
 * Used by Firebase AI (Gemini 2.0 Flash) to convert dispatcher instructions
 * into machine-readable constraints the optimization engine can consume.
 */

export type ConstraintType =
  | "skip"
  | "avoid"
  | "time_window"
  | "direction"
  | "priority"
  | "delay"
  | "frequency"
  | "vehicle"
  | "crew"
  | "seasonal"
  | "temporary"
  | "permanent"
  | "capacity"
  | "special_instruction";

export type ConstraintPriority = "low" | "medium" | "high" | "critical";

export interface ConstraintTarget {
  street: string | null;
  zone: string | null;
  area: string | null;
  coordinates: [number, number] | null;
}

export interface ConstraintSchedule {
  days: string[] | null;
  time_start: string | null;
  time_end: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  season: string | null;
  recurring: boolean;
}

export interface ParsedConstraint {
  id: string;
  type: ConstraintType;
  target: ConstraintTarget;
  schedule: ConstraintSchedule;
  conditions: string[];
  parameters: Record<string, unknown>;
  permanent: boolean;
  reason: string;
  priority: ConstraintPriority;
  confidence: number;
  ambiguities: string[];
  dispatcher_confirmation_needed: boolean;
}

export interface ConflictDetected {
  new_constraint: string;
  conflicts_with: string;
  resolution_suggestion: string;
}

export interface ParsedConstraintResult {
  analysis_type: "constraint_parsing";
  original_input: string;
  parsed_constraints: ParsedConstraint[];
  conflicts_detected: ConflictDetected[];
  summary: string;
}
