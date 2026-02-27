/**
 * Read a File or Blob as text. Used on web (OSM drop zone, fetch+blob path). Not used on iOS:
 * iOS OSM import uses FileSystem.readAsStringAsync in osm-import.tsx.
 *
 * NEVER calls file.text(), blob.text(), or response.text() — any .text() can be undefined and cause "text is not a function".
 * Uses only FileReader.readAsText(blob) and response.blob() (no .text() anywhere).
 */
export function readFileAsText(file: File | Blob): Promise<string> {
  if (!file) {
    return Promise.reject(new Error("No file provided"));
  }
  // Ensure we have a Blob-like object (File extends Blob)
  const blob = file instanceof Blob ? file : (file as unknown as Blob);
  if (typeof blob.slice !== "function") {
    return Promise.reject(new Error("Invalid file: not a File or Blob"));
  }

  function readBlobWithFileReader(b: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) ?? "");
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
      reader.readAsText(b, "UTF-8");
    });
  }

  function viaFetch(): Promise<string> {
    if (
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function" ||
      typeof fetch !== "function"
    ) {
      return Promise.reject(new Error("fetch/URL not available"));
    }
    const url = URL.createObjectURL(blob);
    return fetch(url)
      .then((res) => {
        // Only use response.blob() — do not call response.text() here (can throw "text is not a function" in some envs)
        if (typeof (res as { blob?: () => Promise<Blob> }).blob !== "function") {
          return Promise.reject(new Error("Response has no blob()"));
        }
        return (res as { blob: () => Promise<Blob> }).blob().then(readBlobWithFileReader);
      })
      .finally(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      });
  }

  if (typeof FileReader !== "undefined") {
    return readBlobWithFileReader(blob).catch(() => viaFetch());
  }
  return viaFetch();
}
