/**
 * Store GPX files in Firebase Storage and metadata in Realtime Database.
 * Secure via auth: rules require auth != null for read/write.
 * When Firebase is not loaded (web/Expo Go), functions throw a clear error.
 */
import { database, ensureAppCheckReady, storage } from "./index";

const DB_ROUTES = "routes";
const DB_GPX_METADATA = "gpx_files";
const STORAGE_GPX_PREFIX = "gpx_files";

function requireStorage(): () => {
  ref: (path: string) => {
    putFile: (uri: string) => Promise<unknown>;
    getDownloadURL: () => Promise<string>;
  };
} {
  if (!storage || typeof storage !== "function") {
    throw new Error(
      "Firebase Storage is not available. Use a development build with Firebase for GPX upload.",
    );
  }
  return storage as unknown as () => {
    ref: (path: string) => {
      putFile: (uri: string) => Promise<unknown>;
      getDownloadURL: () => Promise<string>;
    };
  };
}

function requireDatabase(): () => {
  ref: (path: string) => {
    set: (v: unknown) => Promise<unknown>;
    get: () => Promise<{ val: () => unknown }>;
    once: (event: string) => Promise<{ val: () => unknown }>;
  };
} {
  if (!database || typeof database !== "function") {
    throw new Error(
      "Firebase Realtime Database is not available. Use a development build with Firebase.",
    );
  }
  return database as unknown as () => {
    ref: (path: string) => {
      set: (v: unknown) => Promise<unknown>;
      get: () => Promise<{ val: () => unknown }>;
      once: (event: string) => Promise<{ val: () => unknown }>;
    };
  };
}

export interface GpxMetadata {
  name: string;
  downloadUrl: string;
  sizeBytes?: number;
  createdAt: number;
  userId: string;
  contentType?: string;
}

/**
 * Upload a GPX file to Storage and save metadata in Realtime Database.
 * @param fileUri - Local file URI (e.g. from expo-document-picker; use file:// or content URI)
 * @param userId - Current user ID (e.g. from Firebase Auth)
 * @param metadata - Optional display name for the file
 */
export async function uploadGpxFile(
  fileUri: string,
  userId: string,
  metadata?: Partial<Pick<GpxMetadata, "name">>,
): Promise<GpxMetadata> {
  await ensureAppCheckReady();
  const filename = metadata?.name ?? `route_${Date.now()}.gpx`;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${STORAGE_GPX_PREFIX}/${userId}/${Date.now()}_${safeName}`;

  const st = requireStorage();
  const db = requireDatabase();
  const ref = st().ref(storagePath);
  const task = ref.putFile(fileUri);
  const snapshot = (await task) as {
    ref: { getDownloadURL: () => Promise<string> };
    metadata?: { name?: string };
  };
  const downloadUrl = await snapshot.ref.getDownloadURL();

  const meta: GpxMetadata = {
    name: filename,
    downloadUrl,
    createdAt: Date.now(),
    userId,
    ...metadata,
  };

  const dbKey = `${DB_GPX_METADATA}/${userId}/${snapshot.metadata?.name ?? storagePath}`;
  await db().ref(dbKey).set(meta);

  return meta;
}

/**
 * Save route metadata only (no file) to Realtime Database.
 */
export async function saveRouteMetadata(
  userId: string,
  routeId: string,
  data: Record<string, string | number | boolean>,
): Promise<void> {
  await ensureAppCheckReady();
  const db = requireDatabase();
  await db()
    .ref(`${DB_ROUTES}/${userId}/${routeId}`)
    .set({ ...data, updatedAt: Date.now() });
}

/**
 * Get metadata for a user's GPX files from Realtime Database.
 */
export async function getGpxFilesMetadata(
  userId: string,
): Promise<Record<string, GpxMetadata>> {
  await ensureAppCheckReady();
  const db = requireDatabase();
  const snapshot = await db().ref(`${DB_GPX_METADATA}/${userId}`).once("value");
  return ((snapshot as { val: () => unknown }).val() ?? {}) as Record<
    string,
    GpxMetadata
  >;
}
