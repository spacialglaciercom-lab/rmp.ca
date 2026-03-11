/**
 * Type declaration for expo-file-system/legacy (used when importing from "expo-file-system/legacy").
 * The legacy export may not ship with its own types in all versions.
 */
declare module "expo-file-system/legacy" {
  export const documentDirectory: string | null;
  export const cacheDirectory: string | null;
  export enum EncodingType {
    UTF8 = "utf8",
    Base64 = "base64",
  }
  export function readAsStringAsync(
    fileUri: string,
    options?: { encoding?: EncodingType },
  ): Promise<string>;
  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { encoding?: EncodingType },
  ): Promise<void>;
  export function readDirectoryAsync(dirUri: string): Promise<string[]>;
  export function deleteAsync(
    fileUri: string,
    options?: { idempotent?: boolean },
  ): Promise<void>;
  export function getInfoAsync(
    fileUri: string,
    options?: { size?: boolean },
  ): Promise<{
    exists: boolean;
    isDirectory?: boolean;
    size?: number;
    uri?: string;
  }>;
  export function makeDirectoryAsync(
    fileUri: string,
    options?: { intermediates?: boolean },
  ): Promise<void>;
  export function downloadAsync(
    uri: string,
    fileUri: string,
    options?: Record<string, unknown>,
  ): Promise<{ uri: string; status: number; headers: Record<string, string> }>;
}
