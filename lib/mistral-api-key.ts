/**
 * Mistral API key storage for route report (AI-enhanced reports).
 * Stored in AsyncStorage so it persists and is available on web and native.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const MISTRAL_API_KEY_STORAGE_KEY = "@trashroute:mistral_api_key";

export async function getMistralApiKey(): Promise<string | null> {
  try {
    const key = await AsyncStorage.getItem(MISTRAL_API_KEY_STORAGE_KEY);
    return key ? key.trim() || null : null;
  } catch {
    return null;
  }
}

export async function setMistralApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await AsyncStorage.setItem(MISTRAL_API_KEY_STORAGE_KEY, trimmed);
  } else {
    await AsyncStorage.removeItem(MISTRAL_API_KEY_STORAGE_KEY);
  }
}

export async function clearMistralApiKey(): Promise<void> {
  await AsyncStorage.removeItem(MISTRAL_API_KEY_STORAGE_KEY);
}
