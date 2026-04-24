/**
 * Firebase + Sign in with Apple — native iOS/Android flow.
 *
 * Uses expo-apple-authentication and @react-native-firebase/auth to sign in
 * with Apple, then returns the Firebase ID token for the backend to verify.
 * Auth is loaded dynamically so the Settings tab can load when RNFB native module
 * is not available (e.g. Expo Go or misconfigured build).
 */
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

const BUNDLE_LOAD_ERROR =
  "Sign-in couldn't load. If you're on a device, ensure it can reach the dev server (same Wi‑Fi or run: npx expo start --tunnel).";

function isBundleLoadError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  const msg = (e as Error)?.message ?? "";
  return (
    name === "LoadBundleFromServerRequestError" ||
    msg.includes("LoadBundleFromServerRequestError") ||
    msg.includes("Could not load bundle")
  );
}

/** Cached Firebase Auth module to avoid loading the bundle again on each sign-in attempt. */
let cachedAuth: typeof import("@react-native-firebase/auth").default | null =
  null;

/**
 * Preload the Firebase Auth module so Sign in with Apple doesn't trigger a bundle load on tap.
 * Call this when Settings/AccountSection mounts so the bundle is ready when the user taps Sign in.
 */
export function preloadFirebaseAuth(): void {
  if (Platform.OS === "web" || cachedAuth !== null) return;
  import("@react-native-firebase/auth")
    .then((mod) => {
      cachedAuth = mod.default;
    })
    .catch(() => {
      // Ignore; will be handled when user taps Sign in
    });
}

/** Optional: ensure App Check is ready before Auth (can prevent auth/internal-error when App Check is enforced). */
async function ensureAppCheckReadyIfAvailable(): Promise<void> {
  try {
    const { ensureAppCheckReady } = await import("@/lib/firebase/index");
    await ensureAppCheckReady();
  } catch {
    // Firebase/App Check not used or not loaded
  }
}

/**
 * Generate a random nonce and its SHA256 hash (Apple expects the hash).
 */
async function generateNonce(): Promise<{
  rawNonce: string;
  hashedNonce: string;
}> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  return { rawNonce, hashedNonce };
}

/**
 * Sign in with Apple via Firebase. Returns the Firebase ID token.
 * Call POST /api/auth/firebase with { idToken } to create a session.
 *
 * Only available on iOS and Android (expo-apple-authentication).
 */
export async function signInWithAppleAndGetIdToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    console.warn("[FirebaseApple] Sign in with Apple is not supported on web");
    return null;
  }

  try {
    await ensureAppCheckReadyIfAvailable();

    const { rawNonce, hashedNonce } = await generateNonce();

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    const { identityToken } = appleCredential;
    if (!identityToken) {
      console.warn("[FirebaseApple] No identity token from Apple");
      return null;
    }

    let auth: typeof import("@react-native-firebase/auth").default;
    if (cachedAuth) {
      auth = cachedAuth;
    } else {
      try {
        const mod = await import("@react-native-firebase/auth");
        auth = mod.default;
        cachedAuth = auth;
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (isBundleLoadError(e)) {
          throw new Error(BUNDLE_LOAD_ERROR);
        }
        if (
          msg.includes("RNFBAppModule") &&
          msg.toLowerCase().includes("not found")
        ) {
          throw new Error(
            "Sign in with Apple is not available in this build. Use a development build with Firebase configured.",
          );
        }
        throw e;
      }
    }
    if (!auth?.OAuthProvider) {
      throw new Error(
        "Sign in with Apple is not available in this build. Use a development build with Firebase configured.",
      );
    }

    const credential = auth.OAuthProvider.credential(
      "apple.com",
      identityToken,
      rawNonce,
    );

    const userCredential = await auth().signInWithCredential(credential);
    const idToken = await userCredential.user.getIdToken();
    return idToken ?? null;
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_REQUEST_CANCELED") {
      // User canceled — not an error
      return null;
    }
    const err = error as {
      code?: string;
      message?: string;
      userInfo?: Record<string, unknown>;
      nativeErrorCode?: number;
    };
    // User-friendly message when Firebase native module is missing (Expo Go or misconfigured build)
    const msg = typeof err.message === "string" ? err.message : "";
    if (
      msg.includes("RNFBAppModule") &&
      msg.toLowerCase().includes("not found")
    ) {
      console.warn("[FirebaseApple] Native Firebase not available:", msg);
      throw new Error(
        "Sign in with Apple is not available in this build. Use a development build with Firebase configured.",
      );
    }
    console.error("[FirebaseApple] Sign in failed:", {
      code: err.code,
      message: err.message,
      nativeErrorCode: err.nativeErrorCode,
      userInfo: err.userInfo,
    });
    throw error;
  }
}
