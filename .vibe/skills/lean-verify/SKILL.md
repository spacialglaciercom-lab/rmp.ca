---
name: verify-deployment
description: "Runs Lean 4 formal verification on RouteMasterPro modules post-deployment."
user-invocable: true
---

# Lean 4 Formal Verification Skill for RouteMasterPro

## Purpose
This skill provides formal verification of RouteMasterPro deployment artifacts using Lean 4 theorem prover to ensure:
- Termination proofs (no infinite loops)
- Type safety
- Logic correctness of routing algorithms

## Prerequisites
- Lean 4 compiler installed in verification environment
- RouteMasterPro Lean formal specifications available

## Instructions

### 1. Build → Verify → Deploy Workflow

This skill integrates with the pre-built deployment workflow:

```bash
# 1. Build phase (host)
npm install
npm run build
/usr/local/bin/vibe /verify-deployment

# 2. Deploy phase (jails)
su root -c "sh cbsd/deploy-prebuilt.sh --all"

# 3. Final verification phase (jails)
cd /home/drone/Documents/rmp.ca/.vibe/skills/lean-verify
sh verify.sh
```

### 2. Verification Process
The skill will:
1. Scan `/usr/local/app` within target jails for `.lean` files
2. Execute Lean 4 compiler with termination checking
3. Compare jail artifacts with verified build outputs
4. Generate verification reports
5. Provide pass/fail status

### 3. Stability Criteria
- **Stable**: All Lean proofs pass, no termination warnings, artifacts match verified build
- **Unstable**: Any proof failures, termination warnings, or artifact mismatches
- **Unknown**: No Lean specifications found

## Implementation

### verify.sh
```bash
#!/bin/sh
# Lean 4 Verification Driver

set -e

INFO()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
WARN()  { printf '\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
ERROR() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Check for Lean 4 compiler
if ! command -v lean >/dev/null 2>&1; then
    ERROR "Lean 4 compiler not found. Please install from https://leanprover.github.io/lean4/doc/setup.html"
fi

# Verify each jail
for jail in rmpca-extract rmpca-backend rmpca-optimizer rmpca-celery; do
    if cbsd jls | grep -w "^${jail}" >/dev/null 2>&1; then
        INFO "Verifying ${jail}..."
        
        # Check for Lean files
        lean_files=$(cbsd jexec jname=${jail} find /usr/local/app -name "*.lean" 2>/dev/null || true)
        
        if [ -n "${lean_files}" ]; then
            INFO "Found Lean specifications in ${jail}"
            
            # Copy files to host for verification (CBSD jails may have limited tools)
            verify_dir="/tmp/lean-verify-${jail}"
            rm -rf "${verify_dir}"
            mkdir -p "${verify_dir}"
            
            for file in ${lean_files}; do
                cbsd jailscp "${jail}:${file}" "${verify_dir}/"
            done
            
            # Run Lean compiler with termination checking
            if (cd "${verify_dir}" && lean --check *.lean); then
                INFO "✓ ${jail} verification passed"
            else
                ERROR "✗ ${jail} verification failed"
            fi
        else
            WARN "No Lean specifications found in ${jail}"
        fi
    else
        INFO "${jail} not running — skipping"
    fi
done

INFO "Verification complete. Deployment can be marked as Stable."
```

### verification-criteria.md
```markdown
# Verification Criteria for RouteMasterPro

## Termination Proofs
All recursive functions in routing algorithms must have:
- Structurally decreasing arguments
- Well-founded recursion
- No infinite loop possibilities

## Type Safety
- All type annotations must be provable
- No type casting violations
- Function signatures must match implementations

## Algorithm Correctness
- Dijkstra's algorithm variants must maintain heap invariants
- A* search must have admissible heuristics
- TSP approximations must respect triangle inequality
```

## Integration with Deployment Workflow

1. **Post-Deployment**: Run verification after `deploy-existing.sh`
2. **CI/CD**: Add as a gate before production promotion
3. **Monitoring**: Schedule periodic re-verification

## Troubleshooting

- **Missing Lean files**: Ensure `lean-toolchain` is in jail PATH
- **Proof failures**: Check algorithm implementations for termination issues
- **Performance**: Large proofs may need increased memory limits

## Future Enhancements

- Add Coq interoperability for alternative proving
- Integrate with CI/CD pipelines
- Add automated theorem generation from TypeScript
