import RmpVerify

/-- Smoke test: run the Hierholzer algorithm on a small triangle graph.
    Nodes: 0, 1, 2.  Edges: 0-1, 1-2, 2-0 (undirected, so each appears twice). -/
def main : IO Unit := do
  -- Triangle graph adjacency
  let adj : Nat → List (Nat × Nat) := fun n =>
    match n with
    | 0 => [(1, 0), (2, 2)]
    | 1 => [(0, 0), (2, 1)]
    | 2 => [(1, 1), (0, 2)]
    | _ => []
  let nodes := [0, 1, 2]
  let circuit := hierholzer nodes adj 0
  IO.println s!"Hierholzer circuit edges: {circuit}"

  -- Test removeImmediateReversals on the known-bad input
  let badRoute := [1, 2, 1, 3, 1]
  let cleaned := removeImmediateReversals badRoute
  IO.println s!"removeImmediateReversals {badRoute} = {cleaned}"
  IO.println s!"Has reversal after cleanup: {hasReversal cleaned}"

  -- Test the fixpoint version
  let fixpointCleaned := removeReversalsFixpoint badRoute
  IO.println s!"removeReversalsFixpoint  {badRoute} = {fixpointCleaned}"
  IO.println s!"Has reversal after fixpoint: {hasReversal fixpointCleaned}"

  -- Test edge deduplication
  let rows : List EdgeRow := [
    { source := 1, target := 2, osmId := some 100, oneway := false, dualCarriageway := false },
    { source := 2, target := 1, osmId := some 100, oneway := false, dualCarriageway := false },
    { source := 3, target := 4, osmId := some 200, oneway := true,  dualCarriageway := false },
  ]
  let deduped := dedupEdgeRows rows
  IO.println s!"Edge rows before dedup: {rows.length}, after: {deduped.length}"
