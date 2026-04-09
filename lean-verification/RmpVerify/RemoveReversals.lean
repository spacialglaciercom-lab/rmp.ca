/-
  RmpVerify.RemoveReversals
  =========================
  Lean 4 translation of `_remove_immediate_reversals` from
  `backend/app/optimize.py` (lines 1289-1327).

  We prove:
    1. **Termination** — the while-loop always terminates.
    2. **Correctness attempt** — "the output contains no A→B→A reversals."
       This proof is expected to FAIL, exposing a real bug.

  Python source (optimize.py:1289-1327):
    def _remove_immediate_reversals(route_nodes):
        if len(route_nodes) < 3: return route_nodes
        cleaned_route, i = [], 0
        while i < len(route_nodes):
            if (i+2 < len(route_nodes) and
                route_nodes[i] == route_nodes[i+2] and
                route_nodes[i] != route_nodes[i+1]):
                if cleaned_route and cleaned_route[-1] == route_nodes[i]:
                    cleaned_route.append(route_nodes[i+2])
                else:
                    cleaned_route.extend([route_nodes[i], route_nodes[i+2]])
                i += 3
            else:
                cleaned_route.append(route_nodes[i])
                i += 1
        final_route = []
        for node in cleaned_route:
            if not final_route or node != final_route[-1]:
                final_route.append(node)
        return final_route
-/

-- ============================================================================
-- 1. HELPER: remove consecutive duplicates
-- ============================================================================

/-- Remove consecutive duplicate elements from a list. -/
def dedup : List Nat → List Nat
  | [] => []
  | [x] => [x]
  | x :: y :: rest =>
    if x == y then dedup (y :: rest)
    else x :: dedup (y :: rest)

-- ============================================================================
-- 2. THE MAIN ALGORITHM (faithful translation)
-- ============================================================================

/-- One pass of the reversal-removal loop.
    Uses `route.length - i` as the termination measure. -/
def removeReversalsLoop (route : List Nat) (i : Nat) (acc : List Nat)
    : List Nat :=
  if h : i < route.length then
    if h2 : i + 2 < route.length then
      let a := route[i]
      let b := route[i + 1]'(by omega)
      let c := route[i + 2]'(by omega)
      if a == c ∧ a ≠ b then
        -- Found A→B→A pattern: skip the middle node
        let acc' := match acc.getLast? with
          | some last => if last == a then acc ++ [c] else acc ++ [a, c]
          | none => [a, c]
        removeReversalsLoop route (i + 3) acc'
      else
        removeReversalsLoop route (i + 1) (acc ++ [route[i]])
    else
      removeReversalsLoop route (i + 1) (acc ++ [route[i]])
  else
    acc
termination_by route.length - i

/-- The full `_remove_immediate_reversals` function. -/
def removeImmediateReversals (route : List Nat) : List Nat :=
  if route.length < 3 then route
  else dedup (removeReversalsLoop route 0 [])

-- ============================================================================
-- 3. TERMINATION PROOF
-- ============================================================================

-- Termination is automatic via `termination_by route.length - i`.
-- Each recursive call increments `i` by at least 1 (either +1 or +3),
-- so `route.length - i` strictly decreases.
-- Lean's built-in termination checker accepts this.

-- ============================================================================
-- 4. CORRECTNESS: "No A→B→A reversals in the output"
-- ============================================================================

/-- A list has an immediate reversal if there exist consecutive elements
    a, b, a where a ≠ b. -/
def hasReversal : List Nat → Bool
  | a :: b :: c :: rest => (a == c && a != b) || hasReversal (b :: c :: rest)
  | _ => false

-- COUNTEREXAMPLE demonstrating the correctness bug.
--
-- Input:  [1, 2, 1, 3, 1]
-- This contains TWO overlapping reversals: 1→2→1 and 1→3→1.
--
-- The Python function processes left-to-right in one pass:
--   i=0: sees 1,2,1 (reversal!), emits [1,1], i=3
--   i=3: sees 3, emits [1,1,3], i=4
--   i=4: sees 1, emits [1,1,3,1], i=5
--   Dedup: [1,3,1]
--
-- Output: [1, 3, 1] — which STILL contains the reversal 1→3→1!
theorem counterexample_reversals_survive :
    hasReversal (removeImmediateReversals [1, 2, 1, 3, 1]) = true := by
  native_decide

-- The correctness theorem we WANT to hold — but it is FALSE.
-- Stating it so Lean can confirm it's unprovable for all inputs.
theorem removeReversals_correct_FAILS (route : List Nat) :
    hasReversal (removeImmediateReversals route) = false := by
  sorry -- UNPROVABLE: counterexample [1, 2, 1, 3, 1] shows this is false.
         -- The Python function needs to loop until a fixpoint to be correct.

-- ============================================================================
-- 5. PROPOSED FIX: iterate until fixpoint
-- ============================================================================

/-- Repeatedly apply reversal removal until no reversals remain. -/
def removeReversalsFixpoint (route : List Nat) (fuel : Nat := route.length) : List Nat :=
  match fuel with
  | 0 => route
  | fuel' + 1 =>
    let cleaned := removeImmediateReversals route
    if cleaned.length < route.length then
      removeReversalsFixpoint cleaned fuel'
    else
      cleaned

-- The fixpoint version terminates because each iteration strictly shrinks
-- the route (removing at least one node per reversal removed), bounded
-- by the initial route length.

-- ============================================================================
-- 6. SUMMARY
-- ============================================================================

/-
  VERIFICATION RESULTS FOR _remove_immediate_reversals (optimize.py:1289):
  ========================================================================

  1. TERMINATION: ✅ PROVEN
     `termination_by route.length - i` — Lean accepts this automatically.
     Each loop iteration advances `i` by at least 1, bounded by `route.length`.

  2. CORRECTNESS (no reversals in output): ❌ FAILS — BUG DETECTED
     Counterexample: input [1, 2, 1, 3, 1]
       → After one pass: [1, 3, 1]
       → Output STILL contains reversal 1→3→1

     ROOT CAUSE: The function makes a single left-to-right pass. When removing
     a reversal A→B→A creates a NEW reversal with the surrounding context
     (because A was already adjacent to the next element), the new reversal
     is not caught.

     FIX: Apply `removeImmediateReversals` in a loop until the output
     stabilizes (fixpoint iteration). This is guaranteed to terminate because
     each pass that finds a reversal removes at least 1 node, and routes are finite.
-/
