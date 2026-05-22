import Lean.Data.Json
import Lean.Data.Json.FromToJson

structure Node where
  id : String
  deriving Lean.FromJson, Lean.ToJson, Inhabited, Repr

structure Edge where
  u : String
  v : String
  id : String
  deriving Lean.FromJson, Lean.ToJson, Inhabited, Repr

structure OriginalGraph where
  nodes : Array Node
  edges : Array Edge
  deriving Lean.FromJson, Lean.ToJson, Inhabited, Repr

structure Trace where
  original_graph : OriginalGraph
  circuit : Array String
  deriving Lean.FromJson, Lean.ToJson, Inhabited, Repr

def findEdge (edges : Array Edge) (id : String) : Option Edge :=
  edges.find? (fun e => e.id == id)

def validateContinuity (edges : Array Edge) (circuit : Array String) : IO Bool := do
  if circuit.size == 0 then return true
  let mut prevTarget : Option String := none

  for eId in circuit do
    match findEdge edges eId with
    | none =>
      IO.println s!"Edge {eId} in circuit not found in original graph"
      return false
    | some edge =>
      match prevTarget with
      | none => prevTarget := some edge.v
      | some prev =>
        if prev != edge.u then
          IO.println s!"Continuity broken: edge {eId} starts at {edge.u} but previous edge ended at {prev}"
          return false
        prevTarget := some edge.v

  IO.println "✓ Continuity validated"
  return true

def validateCoverage (edges : Array Edge) (circuit : Array String) : IO Bool := do
  if edges.size != circuit.size then
    IO.println s!"Coverage failed: Graph has {edges.size} edges, circuit has {circuit.size} edges"
    return false

  for e in edges do
    if !(circuit.contains e.id) then
      IO.println s!"Coverage failed: Edge {e.id} is missing from circuit"
      return false

  IO.println "✓ Coverage validated"
  return true

def validateClosure (edges : Array Edge) (circuit : Array String) : IO Bool := do
  if circuit.size == 0 then return true

  let firstEdgeId := circuit[0]!
  let lastEdgeId := circuit[circuit.size - 1]!

  let firstEdge := findEdge edges firstEdgeId
  let lastEdge := findEdge edges lastEdgeId

  match firstEdge, lastEdge with
  | some f, some l =>
    if f.u != l.v then
      IO.println s!"Closure failed: Circuit starts at {f.u} but ends at {l.v}"
      return false
    IO.println "✓ Closure validated"
    return true
  | _, _ =>
    IO.println "Closure failed: Could not find first or last edge"
    return false

def validateMapping (edges : Array Edge) (circuit : Array String) : IO Bool := do
  for e in circuit do
    if (findEdge edges e).isNone then
      IO.println s!"Mapping failed: Edge {e} in circuit not found in graph edges"
      return false

  IO.println "✓ Mapping validated"
  return true

def main (args : List String) : IO UInt32 := do
  if args.length != 1 then
    IO.println "Usage: validator <trace.json>"
    return 1

  let filename := args[0]!
  let content ← IO.FS.readFile filename

  match Lean.Json.parse content with
  | Except.error e =>
    IO.println s!"Failed to parse JSON: {e}"
    return 1
  | Except.ok json =>
    match Lean.fromJson? (α := Trace) json with
    | Except.error e =>
      IO.println s!"Failed to decode Trace: {e}"
      return 1
    | Except.ok trace =>
      IO.println "Loaded trace successfully. Validating Eulerian properties..."

      let mut valid := true

      if !(← validateMapping trace.original_graph.edges trace.circuit) then valid := false
      if !(← validateCoverage trace.original_graph.edges trace.circuit) then valid := false
      if !(← validateContinuity trace.original_graph.edges trace.circuit) then valid := false
      if !(← validateClosure trace.original_graph.edges trace.circuit) then valid := false

      if valid then
        IO.println "
SUCCESS: The trace is a valid Eulerian circuit!"
        return 0
      else
        IO.println "
FAILURE: The trace is NOT a valid Eulerian circuit."
        return 1
