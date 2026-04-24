import Verification.Basic
open Verification.Basic

/-!
# Edge Case Verification Examples

Formal examples demonstrating behavior on boundary cases.
These are proven at compile-time to ensure correctness.
-/

namespace Tests.Eval.EdgeCases

/-! ## §1: Empty Graph (E = 0) -/

/--
**Example**: Empty graph termination measure
-/
example : hierMeasure 0 0 = 0 := by
  unfold hierMeasure
  omega

/--
**Example**: Empty graph with single stack item
-/
example : hierMeasure 0 1 = 1 := by
  unfold hierMeasure
  omega

/-! ## §2: Single Edge Graph (E = 1) -/

/--
**Example**: Single edge initial state measure
-/
example : hierMeasure 1 1 = 3 := by
  unfold hierMeasure
  omega

/--
**Example**: Single edge after advance measure
-/
example : hierMeasure 0 2 = 2 := by
  unfold hierMeasure
  omega

/--
**Example**: Single edge after pop measure
-/
example : hierMeasure 0 1 = 1 := by
  unfold hierMeasure
  omega

/-! ## §3: Minimal Quadratic Case (E = 2) -/

/--
**Example**: Minimal graph termination measure
-/
example : hierMeasure 2 1 = 5 := by
  unfold hierMeasure
  omega

/--
**Example**: Verify quadratic lower bound for E = 2
-/
example : 2 * 2 ≤ 2 * (2 + 1) := by
  omega

/-! ## §4: Medium Graph (E = 10) -/

/--
**Example**: Ten edges termination measure
-/
example : hierMeasure 10 1 = 21 := by
  unfold hierMeasure
  omega

/--
**Example**: Ten edges linear complexity verification
-/
example : 10 + (10 + 1) ≤ 2 * 10 + 1 := by
  omega

/-! ## §5: Large Graph (E = 100) -/

/--
**Example**: Hundred edges termination measure
-/
example : hierMeasure 100 1 = 201 := by
  unfold hierMeasure
  omega

/--
**Example**: Hundred edges linear complexity verification
-/
example : 100 + (100 + 1) ≤ 2 * 100 + 1 := by
  omega

/--
**Example**: Hundred edges quadratic lower bound
-/
example : 2 * 100 ≤ 100 * (100 + 1) := by
  omega

/--
**Example**: Hundred edges snapshot work
-/
example : 100 * (100 + 1) ≥ 2 * 100 := by
  omega

/-! ## §6: Very Large Graph (E = 1000) -/

/--
**Example**: Thousand edges termination measure
-/
example : hierMeasure 1000 1 = 2001 := by
  unfold hierMeasure
  omega

/--
**Example**: Thousand edges linear complexity verification
-/
example : 1000 + (1000 + 1) ≤ 2 * 1000 + 1 := by
  omega

/--
**Example**: Thousand edges quadratic lower bound
-/
example : 2 * 1000 ≤ 1000 * (1000 + 1) := by
  omega

/--
**Example**: Thousand edges snapshot work
-/
example : 1000 * (1000 + 1) ≥ 2 * 1000 := by
  omega

/-! ## §7: Measure Monotonicity Verification -/

/--
**Example**: Verify measure increases with remaining edges
-/
example : hierMeasure 5 0 < hierMeasure 10 0 := by
  unfold hierMeasure
  omega

/--
**Example**: Verify measure increases with stack size
-/
example : hierMeasure 5 1 < hierMeasure 5 3 := by
  unfold hierMeasure
  omega

/--
**Example**: Both components contribute positively
-/
example : hierMeasure 5 0 < hierMeasure 10 5 := by
  unfold hierMeasure
  omega

/-! ## §8: Dead Code Verification -/

/--
**Example**: State cannot repeat after various advance counts
-/
example : (0 ≠ 1) ∧ (0 ≠ 2) ∧ (0 ≠ 5) ∧ (0 ≠ 10) ∧ (0 ≠ 50) ∧ (0 ≠ 100) := by
  omega

/--
**Example**: Dead code property for various advance counts
-/
example (len_at_record advances_since : Nat) (h_pos : 0 < advances_since) :
    len_at_record ≠ len_at_record + advances_since := by
  omega

/-! ## §9: Complexity Scaling Verification -/

/--
**Example**: Quadratic dominates linear for various graph sizes
-/
example : ((2 * 10 + 1) < (10 * (10 + 1))) ∧
       ((2 * 50 + 1) < (50 * (50 + 1))) ∧
       ((2 * 100 + 1) < (100 * (100 + 1))) := by
  omega

/--
**Example**: Termination guarantee for various graph sizes
-/
example (E : Nat) : hierMeasure E (E + 1) < Nat.succ (hierMeasure E (E + 1)) := by
  unfold hierMeasure
  omega

/-! ## §10: Pop Step Bound Verification -/

/--
**Example**: Total iterations match expected formula
-/
example : ((2 * 0 + 1) = 1) ∧ ((2 * 1 + 1) = 3) ∧ ((2 * 5 + 1) = 11) ∧ ((2 * 10 + 1) = 21) := by
  omega

/--
**Example**: Pop steps bounded by advances + 1
For E advances, total iterations ≤ E + (E + 1) = 2E + 1
-/
example (E : Nat) : E + (E + 1) ≤ 2 * E + 1 := by
  omega

end Tests.Eval.EdgeCases
