/**
 * Type declarations for expo-location and expo-speech when used by NavigationEngine.
 * Full types come from the packages after `pnpm install`.
 */
declare module "expo-location" {
  export const Accuracy: Record<string, number>;
  export function requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  export function watchPositionAsync(
    options: object,
    callback: (location: { coords: { latitude: number; longitude: number; heading?: number; speed?: number; accuracy?: number } }) => void
  ): Promise<{ remove: () => void }>;
}

declare module "expo-speech" {
  export function speak(
    text: string,
    options?: { language?: string; rate?: number; pitch?: number }
  ): void;
}
