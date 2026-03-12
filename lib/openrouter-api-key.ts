/**
 * OpenRouter API key storage for general chat & Co-Pilot fallback.
 * Stored in AsyncStorage so it persists and is available on web and native.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const OPENROUTER_API_KEY_STORAGE_KEY = "@trashroute:openrouter_api_key";

export async function getOpenRouterApiKey(): Promise<string | null> {
  try {
    const key = await AsyncStorage.getItem(OPENROUTER_API_KEY_STORAGE_KEY);
    return key ? key.trim() || null : null;
  } catch {
    return null;
  }
}

export async function setOpenRouterApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await AsyncStorage.setItem(OPENROUTER_API_KEY_STORAGE_KEY, trimmed);
  } else {
    await AsyncStorage.removeItem(OPENROUTER_API_KEY_STORAGE_KEY);
  }
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await AsyncStorage.removeItem(OPENROUTER_API_KEY_STORAGE_KEY);
}
