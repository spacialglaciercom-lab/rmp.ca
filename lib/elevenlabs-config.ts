/**
 * ElevenLabs configuration storage — API key + selected voice ID.
 * Stored in AsyncStorage so it persists on web and native.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const ELEVENLABS_API_KEY = "@trashroute:elevenlabs_api_key";
const ELEVENLABS_VOICE_ID = "@trashroute:elevenlabs_voice_id";
const ELEVENLABS_VOICE_NAME = "@trashroute:elevenlabs_voice_name";
const ELEVENLABS_ENABLED = "@trashroute:elevenlabs_enabled";

// ── API Key ─────────────────────────────────────────────────────────────────

export async function getElevenLabsApiKey(): Promise<string | null> {
  try {
    const key = await AsyncStorage.getItem(ELEVENLABS_API_KEY);
    return key ? key.trim() || null : null;
  } catch {
    return null;
  }
}

export async function setElevenLabsApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await AsyncStorage.setItem(ELEVENLABS_API_KEY, trimmed);
  } else {
    await AsyncStorage.removeItem(ELEVENLABS_API_KEY);
  }
}

// ── Voice Selection ─────────────────────────────────────────────────────────

export async function getElevenLabsVoiceId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ELEVENLABS_VOICE_ID);
  } catch {
    return null;
  }
}

export async function setElevenLabsVoiceId(
  id: string,
  name: string,
): Promise<void> {
  await AsyncStorage.setItem(ELEVENLABS_VOICE_ID, id);
  await AsyncStorage.setItem(ELEVENLABS_VOICE_NAME, name);
}

export async function getElevenLabsVoiceName(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ELEVENLABS_VOICE_NAME);
  } catch {
    return null;
  }
}

// ── Enabled toggle ──────────────────────────────────────────────────────────

export async function isElevenLabsEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ELEVENLABS_ENABLED);
    return val === "true";
  } catch {
    return false;
  }
}

export async function setElevenLabsEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ELEVENLABS_ENABLED, enabled ? "true" : "false");
}
