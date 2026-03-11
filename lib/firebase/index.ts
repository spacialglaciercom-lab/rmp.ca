/**
 * Firebase SDK initialization and exports for React Native.
 * Requires google-services.json (Android) and GoogleService-Info.plist (iOS).
 *
 * Compatibility:
 * - Web / Expo Go: Native Firebase is not loaded; stub Firestore returns empty routes and no-op
 *   snapshot so FirebaseContext finishes loading. Storage/DB helpers throw a clear error if called.
 * - Development build (iOS/Android): Full Firebase (Firestore, Storage, Realtime DB) when configured.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

type FirestoreDoc = { id: string; data: () => Record<string, unknown> };
type FirestoreSnapshot = {
  docs: FirestoreDoc[];
  forEach: (fn: (doc: FirestoreDoc) => void) => void;
};

type FirestoreCollectionRef = {
  onSnapshot: (
    onNext: (s: { docs: FirestoreDoc[] }) => void,
    onError?: (err: Error) => void,
  ) => () => void;
  get: () => Promise<FirestoreSnapshot>;
};

type FirestoreDb = {
  collection: (name: string) => FirestoreCollectionRef;
};

const noop = (): (() => void) => () => {};
const emptyDocs: FirestoreDoc[] = [];

const stubFirestoreDb: FirestoreDb = {
  collection: () => ({
    onSnapshot: (onNext, _onError) => {
      // Call onNext once so FirebaseContext gets routes=[] and loading=false (web/Expo Go)
      const snapshot = { docs: emptyDocs };
      queueMicrotask(() => onNext(snapshot));
      return noop;
    },
    get: () =>
      Promise.resolve({
        docs: emptyDocs,
        forEach: (fn: (doc: FirestoreDoc) => void) => emptyDocs.forEach(fn),
      }),
  }),
};

let firebase: unknown = null;
let database: unknown = null;
let firestore: unknown = null;
let storage: unknown = null;
let firestoreDb: FirestoreDb = stubFirestoreDb;
let db: unknown = null;
let storageRef: unknown = null;

/** Resolves when App Check is initialized (or immediately if Firebase/App Check not used). Await before first Firestore/Storage use. */
let appCheckReadyPromise: Promise<void> | null = null;

let nativeInitDone = false;

/**
 * Load native Firebase (and gRPC/OkHttp) only on first use. Defers init until ensureAppCheckReady()
 * or first Firestore/Storage use to reduce startup memory and avoid OOM on low-memory devices
 * (e.g. tablets, Rebecco) where gRPC can exhaust the heap if loaded too early.
 */
function ensureFirebaseNativeLoaded(): void {
  if (
    nativeInitDone ||
    Platform.OS === "web" ||
    Constants.appOwnership === "expo"
  ) {
    return;
  }
  nativeInitDone = true;
  try {
    const firebaseApp = require("@react-native-firebase/app");
    firebase = firebaseApp.default;
    require("@react-native-firebase/crashlytics");
    database = require("@react-native-firebase/database").default;
    firestore = require("@react-native-firebase/firestore").default;
    storage = require("@react-native-firebase/storage").default;
    firestoreDb = (firestore as () => FirestoreDb)();
    db = (database as () => unknown)();
    storageRef = (storage as () => unknown)();

    const appCheckApi = (
      firebase as {
        appCheck: () => {
          initializeAppCheck: (opts: unknown) => Promise<void>;
          newReactNativeFirebaseAppCheckProvider: () => {
            configure: (opts: unknown) => void;
          };
        };
      }
    ).appCheck?.();
    if (appCheckApi) {
      const debugToken =
        (typeof Constants.expoConfig?.extra === "object" &&
        Constants.expoConfig?.extra !== null &&
        "firebaseAppCheckDebugToken" in Constants.expoConfig.extra
          ? (
              Constants.expoConfig.extra as {
                firebaseAppCheckDebugToken?: string;
              }
            ).firebaseAppCheckDebugToken
          : undefined) ??
        (typeof process !== "undefined"
          ? (process as NodeJS.Process & { env?: Record<string, string> }).env
              ?.EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN
          : undefined);
      const token =
        (typeof debugToken === "string" ? debugToken : "").trim() || undefined;
      const provider = appCheckApi.newReactNativeFirebaseAppCheckProvider();
      provider.configure({
        android: {
          provider: __DEV__ ? "debug" : "playIntegrity",
          debugToken: token,
        },
        apple: {
          provider: __DEV__ ? "debug" : "deviceCheck",
          debugToken: token,
        },
        web: { provider: "reCaptchaV3", siteKey: "none" },
      });
      appCheckReadyPromise = appCheckApi
        .initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true })
        .catch((e: unknown) => {
          if (__DEV__) {
            console.warn(
              "[Firebase] App Check init failed (Firestore/Storage may return invalid token):",
              e instanceof Error ? e.message : e,
            );
          }
        });
    }
  } catch (e) {
    if (__DEV__) {
      console.warn(
        "[Firebase] Init skipped (missing native module or Firebase not configured):",
        (e as Error).message,
      );
    }
  }
}

/** Call before first Firestore/Storage/Realtime DB use so App Check token is ready. Triggers lazy native Firebase/gRPC init. */
export function ensureAppCheckReady(): Promise<void> {
  ensureFirebaseNativeLoaded();
  return appCheckReadyPromise ?? Promise.resolve();
}

export { firebase, database, firestore, storage };
export { firestoreDb, db, storageRef };
