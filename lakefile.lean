import Lake
open Lake DSL

package «verification» {
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}

require mathlib from git
  "https://github.com/leanprover-community/mathlib4" @ "v4.29.0"

lean_lib «Verification» {
}

lean_lib «Tests» {
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}

@[default_target]
lean_exe «verification» {
  root := `Main
}

lean_exe «tests» {
  root := `Tests.Main
  supportInterpreter := true
  moreLeanArgs := #[
    "-DwarningAsError=true"
  ]
}

lean_exe «validator» {
  root := `Validator
  supportInterpreter := true
}
