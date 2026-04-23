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
    if cbsd jls 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -w "^${jail}" >/dev/null 2>&1; then
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
                INFO "✓ ${jail} Lean verification passed"
                
                # Compare with verified build artifacts
                REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
                if [ -d "${REPO_ROOT}/verified-builds/${jail}" ]; then
                    if diff -r "${REPO_ROOT}/verified-builds/${jail}" "${verify_dir}" >/dev/null 2>&1; then
                        INFO "✓ ${jail} artifact comparison passed"
                    else
                        ERROR "✗ ${jail} artifact comparison failed - jail content differs from verified build"
                    fi
                else
                    WARN "No verified build artifacts found for ${jail} - cannot compare"
                fi
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
