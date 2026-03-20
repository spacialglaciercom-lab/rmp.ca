/**
 * Moonshine Voice model download, caching, and lifecycle management.
 *
 * Models are stored in the device's document directory under `moonshine-models/`.
 * Each model contains 3 ONNX files: encoder, decoder, and tokenizer.
 *
 * Uses the new expo-file-system class-based API (Paths, File, Directory).
 */
import { Paths, File, Directory } from "expo-file-system";
import { Platform } from "react-native";
import { createLogger } from "@/lib/logger";

const log = createLogger("MoonshineModelManager");

/** Base CDN URL for downloading Moonshine model files. */
const MODEL_CDN_BASE = "https://download.moonshine.ai/model";

/** Files that make up a complete Moonshine model. */
const MODEL_FILES = [
  "encoder_model.ort",
  "decoder_model_merged.ort",
  "tokenizer.bin",
] as const;

export interface MoonshineModelInfo {
  /** Model identifier, e.g. "tiny-streaming-en" */
  name: string;
  /** Human-readable label */
  label: string;
  /** Approximate download size in MB */
  sizeMB: number;
  /** Word error rate (lower is better) */
  wer: number;
  /** Model architecture constant for native module */
  arch: number;
  /** Whether this model supports streaming transcription */
  streaming: boolean;
}

/** Available Moonshine models for download. */
export const MOONSHINE_MODELS: MoonshineModelInfo[] = [
  {
    name: "tiny-streaming-en",
    label: "Tiny Streaming",
    sizeMB: 15,
    wer: 12.0,
    arch: 2, // TINY_STREAMING
    streaming: true,
  },
  {
    name: "small-streaming-en",
    label: "Small Streaming",
    sizeMB: 60,
    wer: 7.84,
    arch: 4, // SMALL_STREAMING
    streaming: true,
  },
  {
    name: "medium-streaming-en",
    label: "Medium Streaming",
    sizeMB: 120,
    wer: 6.65,
    arch: 5, // MEDIUM_STREAMING
    streaming: true,
  },
  {
    name: "base-en",
    label: "Base",
    sizeMB: 30,
    wer: 10.07,
    arch: 1, // BASE
    streaming: false,
  },
];

/** Manifest stored alongside downloaded models for version tracking. */
interface ModelManifest {
  modelName: string;
  version: string;
  downloadedAt: string;
  files: string[];
}

function getModelsDir(): Directory {
  return new Directory(Paths.document, "moonshine-models");
}

function getModelDir(modelName: string): Directory {
  return new Directory(Paths.document, "moonshine-models", modelName);
}

function getManifestFile(modelName: string): File {
  return new File(getModelDir(modelName), "manifest.json");
}

/**
 * Check whether a model is fully downloaded and available locally.
 */
export function isModelDownloaded(modelName: string): boolean {
  if (Platform.OS === "web") return false;

  try {
    const manifest = getManifestFile(modelName);
    if (!manifest.exists) return false;

    // Verify all model files exist
    const modelDir = getModelDir(modelName);
    for (const fileName of MODEL_FILES) {
      const file = new File(modelDir, fileName);
      if (!file.exists) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the local file path (URI) for a downloaded model (for passing to native module).
 * Returns null if the model is not downloaded.
 */
export function getModelPath(modelName: string): string | null {
  if (!isModelDownloaded(modelName)) return null;
  return getModelDir(modelName).uri;
}

/**
 * Download a Moonshine model from the CDN.
 *
 * @param modelName  Model identifier (e.g. "tiny-streaming-en")
 * @param onProgress Callback with download progress (0.0 to 1.0)
 * @returns Local URI to the downloaded model directory
 */
export async function downloadModel(
  modelName: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const modelDir = getModelDir(modelName);

  // Ensure directory exists
  if (!modelDir.exists) {
    modelDir.create({ intermediates: true });
  }

  const totalFiles = MODEL_FILES.length;
  let completedFiles = 0;

  for (const fileName of MODEL_FILES) {
    const remoteUrl = `${MODEL_CDN_BASE}/${modelName}/quantized/${fileName}`;
    const destFile = new File(modelDir, fileName);

    log.debug(`Downloading ${fileName} from ${remoteUrl}`);

    await File.downloadFileAsync(remoteUrl, destFile, { idempotent: true });

    completedFiles++;
    onProgress?.(completedFiles / totalFiles);
  }

  // Write manifest
  const manifest: ModelManifest = {
    modelName,
    version: "2.0.0",
    downloadedAt: new Date().toISOString(),
    files: [...MODEL_FILES],
  };
  const manifestFile = getManifestFile(modelName);
  if (!manifestFile.exists) {
    manifestFile.create({ intermediates: true });
  }
  manifestFile.write(JSON.stringify(manifest));

  log.debug(`Model ${modelName} downloaded to ${modelDir.uri}`);
  return modelDir.uri;
}

/**
 * Delete a downloaded model to free storage.
 */
export function deleteModel(modelName: string): void {
  const modelDir = getModelDir(modelName);
  if (modelDir.exists) {
    modelDir.delete();
    log.debug(`Model ${modelName} deleted`);
  }
}

/**
 * Get total storage used by all downloaded Moonshine models.
 */
export function getStorageUsage(): {
  totalBytes: number;
  models: Record<string, number>;
} {
  const result: { totalBytes: number; models: Record<string, number> } = {
    totalBytes: 0,
    models: {},
  };

  for (const model of MOONSHINE_MODELS) {
    let modelSize = 0;
    const modelDir = getModelDir(model.name);
    for (const fileName of MODEL_FILES) {
      try {
        const file = new File(modelDir, fileName);
        if (file.exists) {
          modelSize += file.size;
        }
      } catch {
        /* skip missing files */
      }
    }
    if (modelSize > 0) {
      result.models[model.name] = modelSize;
      result.totalBytes += modelSize;
    }
  }

  return result;
}

/**
 * Find the best available model (prefer higher quality, fall back to any downloaded).
 * Returns null if no model is available.
 */
export function getBestAvailableModel(): MoonshineModelInfo | null {
  // Prefer streaming models, ordered by quality (lowest WER first)
  const streamingModels = MOONSHINE_MODELS.filter((m) => m.streaming).sort(
    (a, b) => a.wer - b.wer,
  );

  for (const model of streamingModels) {
    if (isModelDownloaded(model.name)) {
      return model;
    }
  }

  // Fall back to any downloaded model
  for (const model of MOONSHINE_MODELS) {
    if (isModelDownloaded(model.name)) {
      return model;
    }
  }

  return null;
}
