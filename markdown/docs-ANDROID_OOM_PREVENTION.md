# Android OutOfMemoryError (OOM) Prevention

This doc summarizes mitigations for the **gRPC/OkHttp AsyncSink** OOM (`java.lang.OutOfMemoryError`) seen on some Android devices (e.g. tablets, Rebecco), where the heap hits its limit and a small allocation fails after GC.

## What we did

1. **`android:largeHeap="true"`**  
   Plugin: `plugins/withAndroidLargeHeap.js`. Use as a **mitigation only**; it does not fix leaks.

2. **Lazy Firebase/gRPC init**  
   In `lib/firebase/index.ts`, native Firebase (and thus gRPC/OkHttp) is loaded on **first use** (when `ensureAppCheckReady()` is called), not at app startup. This reduces startup memory and avoids loading gRPC while other heavy work (maps, etc.) is already running.

3. **FirebaseContext**  
   Already uses dynamic `import("@/lib/firebase/index")` and cleans up the Firestore `onSnapshot` unsubscribe in `useEffect` cleanup.

## Recommendations (from crash analysis)

- **Images**: Prefer `expo-image` with appropriate `contentFit` and size; avoid loading full-resolution bitmaps when a smaller size is enough (e.g. thumbnails).
- **Lists**: Use `FlatList` / `FlashList` with windowing for long lists; avoid rendering hundreds of items with `.map()`.
- **Resources**: Close streams and release large objects in lifecycle (e.g. `useEffect` cleanup). Prefer `Application` context for long-lived services to avoid Activity leaks.
- **Tablets / Rebecco**: Test on target devices; these can have tighter memory limits or different GC behavior.
- **Debugging**: Use Android Studio Memory Profiler and heap dumps to find large retained objects and leaks.

## References

- [Android `largeHeap`](https://developer.android.com/reference/android/R.attr#largeHeap)
- Crash blame frame: `io.grpc.okhttp.AsyncSink$2.doRun` (Firebase/Google SDK uses gRPC)
