/**
 * Download GPX files from Firebase Storage for use in the route optimizer / map.
 * Path convention: gpx_files/{userId}/routes/{routeId}.gpx or gpx_files/{userId}/{timestamp}_{name}.gpx
 * When Firebase is not loaded (web/Expo Go), functions throw a clear error.
 */
import { ensureAppCheckReady, storage } from "./index";
import { Linking } from "react-native";

const STORAGE_GPX_PREFIX = "gpx_files";

function requireStorage(): () => {
  ref: (path: string) => {
    getDownloadURL: () => Promise<string>;
    writeToFile?: (path: string) => { then: (fn: () => void) => void };
  };
} {
  if (!storage || typeof storage !== "function") {
    throw new Error(
      "Firebase Storage is not available. Use a development build with Firebase for GPX download.",
    );
  }
  return storage as unknown as () => {
    ref: (path: string) => {
      getDownloadURL: () => Promise<string>;
      writeToFile?: (path: string) => { then: (fn: () => void) => void };
    };
  };
}

/**
 * Get a long-lived download URL for a GPX file in Storage.
 * Use this URL to fetch GPX XML in JS or open in browser / native map.
 */
export async function getGpxDownloadUrl(
  userId: string,
  routeId: string,
  options?: { subPath?: "routes" | "" },
): Promise<string> {
  await ensureAppCheckReady();
  const st = requireStorage();
  const sub = options?.subPath === "routes" ? "routes/" : "";
  const path = `${STORAGE_GPX_PREFIX}/${userId}/${sub}${routeId}.gpx`;
  const ref = st().ref(path);
  return ref.getDownloadURL();
}

/**
 * Download GPX file as text (for parsing in-app with gpxpy or similar).
 * Fetches the file via the download URL.
 */
export async function getGpxFileAsText(
  userId: string,
  routeId: string,
  options?: { subPath?: "routes" | "" },
): Promise<string> {
  const url = await getGpxDownloadUrl(userId, routeId, options);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download GPX: ${res.status}`);
  if (typeof res.blob !== "function") {
    throw new Error("Cannot read response: response.blob is not available");
  }
  const blob = await res.blob();
  const { readFileAsText } = await import("@/lib/readFileAsText");
  return readFileAsText(blob);
}

/**
 * Download GPX to a local file path (native). Returns the local file path when done.
 * Use with react-native-maps or other native components that accept a file path.
 */
export async function downloadGpxToFile(
  userId: string,
  routeId: string,
  localFilePath: string,
  options?: { subPath?: "routes" | "" },
): Promise<string> {
  await ensureAppCheckReady();
  const st = requireStorage();
  const sub = options?.subPath === "routes" ? "routes/" : "";
  const path = `${STORAGE_GPX_PREFIX}/${userId}/${sub}${routeId}.gpx`;
  const ref = st().ref(path);
  const task = ref.writeToFile?.(localFilePath);
  if (task) await task;
  return localFilePath;
}

/**
 * Open the GPX download URL in the device browser or default handler.
 * Useful for "Open in Maps" or external viewers.
 */
export async function openGpxInExternalApp(
  userId: string,
  routeId: string,
  options?: { subPath?: "routes" | "" },
): Promise<void> {
  const url = await getGpxDownloadUrl(userId, routeId, options);
  try {
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
    else throw new Error("Cannot open URL: " + url);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error("Failed to open download URL");
  }
}
