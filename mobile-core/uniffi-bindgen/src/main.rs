// Thin wrapper around uniffi's built-in CLI.
// Usage: cargo run -p uniffi-bindgen -- generate --library <path/to/librmp_routing.a> --language swift --out-dir bindings/swift
fn main() {
    uniffi::uniffi_bindgen_main()
}
