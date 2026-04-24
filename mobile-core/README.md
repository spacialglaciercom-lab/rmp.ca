# mobile-core

Rust core library shared by the iOS and Android apps.  Currently ships one
crate:

- **`rmp-routing`** — on-device TSP solver (nearest-neighbor + 2-opt + or-opt).
  Exported to Swift and Kotlin via [UniFFI](https://github.com/mozilla/uniffi-rs).

The consuming Expo native module lives at `modules/route-optimizer/` and
dispatches to this library automatically on iOS/Android (see
`lib/routeSolverLocal.ts`).  Web and Vitest keep using the pure-TypeScript
implementation — the integration is backwards-compatible.

---

## Layout

```
mobile-core/
├── Cargo.toml                  # workspace root
├── rmp-routing/                # the routing library crate
│   ├── Cargo.toml
│   ├── build.rs                # (no-op — UniFFI uses proc-macros)
│   └── src/lib.rs              # algorithms + #[uniffi::export] entry points
├── uniffi-bindgen/             # thin CLI wrapper used to emit Swift/Kotlin
│   └── src/main.rs
└── scripts/
    ├── build-ios.sh            # → modules/route-optimizer/ios/Frameworks/RmpRouting.xcframework
    └── build-android.sh        # → modules/route-optimizer/android/src/main/jniLibs/<ABI>/librmp_routing.so
```

---

## Prerequisites

### Rust toolchain

```bash
rustup toolchain install stable
```

### iOS targets

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
# Xcode 15+ and `xcrun` on PATH
```

### Android targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-ndk
# Install the Android NDK and export ANDROID_NDK_HOME=/path/to/ndk
```

---

## Building

### iOS

```bash
./mobile-core/scripts/build-ios.sh
```

Produces:

| Path | Purpose |
| --- | --- |
| `modules/route-optimizer/ios/Frameworks/RmpRouting.xcframework` | Fat lib for device + simulator |
| `modules/route-optimizer/ios/Generated/RmpRouting.swift`        | UniFFI Swift bindings |
| `modules/route-optimizer/ios/Generated/RmpRoutingFFI.h`         | C header |
| `modules/route-optimizer/ios/Generated/RmpRoutingFFI.modulemap` | Module map |

Add the XCFramework to the Xcode target, import the `.swift` file into the
module, and delete the `#if !canImport(RmpRouting)` stub block at the bottom
of `RouteOptimizerModule.swift` once you're confident the framework is linked.

### Android

```bash
./mobile-core/scripts/build-android.sh
```

Then emit the Kotlin bindings (separately, because `cargo-ndk` doesn't):

```bash
cd mobile-core
cargo run -p uniffi-bindgen -- generate \
  --library target/release/librmp_routing.so \
  --language kotlin \
  --out-dir ../modules/route-optimizer/android/src/main/java
```

This drops `uniffi/rmp_routing/rmp_routing.kt` into the module's source tree.
The Kotlin module in `RouteOptimizerModule.kt` probes for that file at
runtime via reflection and flips to the UniFFI path automatically — you do
not need to edit the module code.

---

## Running tests

### Rust

```bash
cd mobile-core
cargo test
```

### TypeScript integration

```bash
pnpm test lib/__tests__/routeSolverLocal.test.ts lib/__tests__/routeSolverNativeBridge.test.ts
```

---

## Adding a new exported function

1. In `rmp-routing/src/lib.rs`, annotate the function and its types:
   ```rust
   #[derive(uniffi::Record)]
   pub struct MyType { pub x: f64 }

   #[uniffi::export]
   pub fn my_function(input: MyType) -> MyType { … }
   ```
2. Rebuild + regenerate bindings:
   ```bash
   ./mobile-core/scripts/build-ios.sh
   ./mobile-core/scripts/build-android.sh
   ```
3. Wire it into the Expo module at `modules/route-optimizer/ios/…swift` and
   `…kotlin`, then expose from `modules/route-optimizer/index.ts`.

---

## Why UniFFI?

Both Swift and Kotlin bindings are generated from the same Rust source — one
`#[uniffi::export]` attribute serves both platforms.  It's the same stack
Mozilla uses for Firefox mobile, and avoids hand-writing C ABIs.

See also: `docs/` (if present) for higher-level architecture, and the
[UniFFI user guide](https://mozilla.github.io/uniffi-rs/).
