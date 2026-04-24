import Lake
open Lake DSL

package «verification» {
  -- Add any package configuration options here
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}

require mathlib from git
  "https://github.com/leanprover-community/mathlib4" @ "v4.29.0"

lean_lib «Verification» {
  -- Add any library configuration options here
}

lean_lib «Tests» {
  -- Add any library configuration options here
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}

@[default_target]
lean_exe «verification» {
  root := `Main
}

-- Test target
lean_exe «tests» {
  root := `Tests.Main
  supportInterpreter := true
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}
