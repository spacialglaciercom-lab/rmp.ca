/**
 * ElevenLabsSection — Settings UI for ElevenLabs TTS configuration.
 *
 * API key is set on the server (Railway). This section only shows:
 * - Enable/disable toggle
 * - Voice picker with preview playback
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  FlatList,
  Switch,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import {
  getElevenLabsVoiceId,
  getElevenLabsVoiceName,
  setElevenLabsVoiceId,
  isElevenLabsEnabled,
  setElevenLabsEnabled,
} from "@/lib/elevenlabs-config";
import type { ElevenLabsVoice } from "@/services/elevenLabsTtsService";

export function ElevenLabsSection() {
  const colors = useColors();

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // Toggle state
  const [enabled, setEnabled] = useState(false);

  // Voice picker state
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(
    null,
  );
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [showVoices, setShowVoices] = useState(false);

  // Server proxy: when ELEVENLABS_API_KEY is set on Railway, no key needed in app
  const [serverHasKey, setServerHasKey] = useState(false);

  // Load saved state (voice + enabled; key is on server)
  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const [voiceId, voiceName, isEnabled] = await Promise.all([
        getElevenLabsVoiceId(),
        getElevenLabsVoiceName(),
        isElevenLabsEnabled(),
      ]);
      setSelectedVoiceId(voiceId);
      setSelectedVoiceName(voiceName);
      setEnabled(isEnabled);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Check if server has ElevenLabs key (Railway env)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getApiBaseUrl } = await import("@/shared/oauth");
        const base = getApiBaseUrl();
        if (!base) return;
        const res = await fetch(`${base}/api/elevenlabs/status`);
        if (cancelled) return;
        const data = (await res.json()) as { configured?: boolean };
        setServerHasKey(data.configured === true);
      } catch {
        if (!cancelled) setServerHasKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Toggle enabled
  const handleToggle = async (value: boolean) => {
    hapticImpact();
    setEnabled(value);
    await setElevenLabsEnabled(value);
  };

  // Load voices
  const handleLoadVoices = async () => {
    if (voices.length > 0) {
      setShowVoices(!showVoices);
      return;
    }
    setLoadingVoices(true);
    setShowVoices(true);
    try {
      const { listVoices } = await import("@/services/elevenLabsTtsService");
      const v = await listVoices();
      setVoices(v);
      if (v.length === 0) {
        setMessage("No voices found. Check your API key.");
      }
    } catch {
      setMessage("Failed to load voices.");
    } finally {
      setLoadingVoices(false);
    }
  };

  // Select a voice
  const handleSelectVoice = async (voice: ElevenLabsVoice) => {
    hapticImpact();
    setSelectedVoiceId(voice.voice_id);
    setSelectedVoiceName(voice.name);
    await setElevenLabsVoiceId(voice.voice_id, voice.name);
  };

  // Preview a voice
  const handlePreview = async (voice: ElevenLabsVoice) => {
    if (!voice.preview_url) return;
    if (playingPreview === voice.voice_id) {
      // Stop current preview
      try {
        const { stopElevenLabsSpeaking } =
          await import("@/services/elevenLabsTtsService");
        await stopElevenLabsSpeaking();
      } catch {}
      setPlayingPreview(null);
      return;
    }
    setPlayingPreview(voice.voice_id);
    try {
      const { playVoicePreview } =
        await import("@/services/elevenLabsTtsService");
      await playVoicePreview(voice.preview_url);
    } catch {}
    setPlayingPreview(null);
  };

  if (loading) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.hint, { color: colors.muted }]}>Loading…</Text>
      </View>
    );
  }

  const switchTrack = {
    false: colors.border,
    true: colors.accentCyan ?? colors.primary,
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={[styles.label, { color: colors.foreground }]}>
        ElevenLabs Voice
      </Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Premium AI voices for Co-Pilot TTS. Key is set on the server (Railway).
      </Text>

      {serverHasKey ? (
        <Text
          style={[styles.caption, { color: colors.primary, marginBottom: 8 }]}
        >
          Server key set (Railway). Use the toggle and voice picker below.
        </Text>
      ) : (
        <Text
          style={[styles.caption, { color: colors.muted, marginBottom: 8 }]}
        >
          Set ELEVENLABS_API_KEY on Railway to enable ElevenLabs TTS.
        </Text>
      )}

      {/* Enable toggle (when server has key) */}
      {serverHasKey && (
        <View style={[styles.toggleRow, { borderColor: colors.border }]}>
          <View style={styles.toggleLabel}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              Use ElevenLabs
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {enabled
                ? selectedVoiceName
                  ? `Active — ${selectedVoiceName}`
                  : "Active — using default voice (Rachel)"
                : "Off — using system TTS"}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={switchTrack}
            thumbColor={
              Platform.OS === "android"
                ? enabled
                  ? (colors.accentCyan ?? colors.primary)
                  : colors.muted
                : undefined
            }
          />
        </View>
      )}

      {/* Voice picker button */}
      {serverHasKey && enabled && (
        <TouchableOpacity
          style={[
            styles.voicePickerButton,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={handleLoadVoices}
        >
          <Text style={[styles.voicePickerText, { color: colors.foreground }]}>
            {showVoices ? "Hide voices" : "Choose voice"}
          </Text>
          {loadingVoices && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginLeft: 8 }}
            />
          )}
        </TouchableOpacity>
      )}

      {/* Voice count */}
      {showVoices && voices.length > 0 && (
        <Text style={[styles.voiceCount, { color: colors.muted }]}>
          {voices.length} voices available
        </Text>
      )}

      {/* Voice list */}
      {showVoices && voices.length > 0 && (
        <View style={[styles.voiceList, { borderColor: colors.border }]}>
          <FlatList
            data={voices}
            keyExtractor={(v) => v.voice_id}
            nestedScrollEnabled
            renderItem={({ item }) => {
              const isSelected = selectedVoiceId === item.voice_id;
              const isPlaying = playingPreview === item.voice_id;
              const gender = item.labels?.gender ?? "";
              const accent = item.labels?.accent ?? "";
              const age = item.labels?.age ?? "";
              const tags = [gender, accent, age].filter(Boolean).join(" · ");

              return (
                <TouchableOpacity
                  style={[
                    styles.voiceItem,
                    {
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected
                        ? colors.primary + "15"
                        : colors.background,
                    },
                  ]}
                  onPress={() => handleSelectVoice(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.voiceInfo}>
                    <Text
                      style={[
                        styles.voiceName,
                        {
                          color: isSelected
                            ? colors.primary
                            : colors.foreground,
                          fontWeight: isSelected ? "700" : "500",
                        },
                      ]}
                    >
                      {item.name}
                      {isSelected ? " ✓" : ""}
                    </Text>
                    {tags ? (
                      <Text style={[styles.voiceTags, { color: colors.muted }]}>
                        {tags}
                      </Text>
                    ) : null}
                  </View>
                  {item.preview_url && (
                    <TouchableOpacity
                      style={[
                        styles.previewButton,
                        {
                          backgroundColor: isPlaying
                            ? colors.error + "20"
                            : colors.primary + "15",
                        },
                      ]}
                      onPress={() => handlePreview(item)}
                    >
                      <Text
                        style={[
                          styles.previewText,
                          { color: isPlaying ? colors.error : colors.primary },
                        ]}
                      >
                        {isPlaying ? "Stop" : "Play"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Message */}
      {message && (
        <Text style={[styles.message, { color: colors.muted }]}>{message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
    color: "#00D9FF",
  },
  description: {
    fontSize: 12,
    marginBottom: 10,
    color: "rgba(255, 255, 255, 0.7)",
  },
  caption: {
    fontSize: 12,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  toggleLabel: {
    flex: 1,
    marginRight: 12,
  },
  voicePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  voicePickerText: {
    fontSize: 14,
    fontWeight: "600",
  },
  voiceList: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    maxHeight: 400,
  },
  voiceCount: {
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  voiceItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 0.5,
    borderColor: "rgba(255,255,255,0.1)",
  },
  voiceInfo: {
    flex: 1,
  },
  voiceName: {
    fontSize: 14,
  },
  voiceTags: {
    fontSize: 11,
    marginTop: 2,
  },
  previewButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginLeft: 10,
  },
  previewText: {
    fontSize: 12,
    fontWeight: "600",
  },
  message: {
    fontSize: 12,
    marginTop: 8,
    color: "rgba(255, 255, 255, 0.7)",
  },
  hint: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.7)",
  },
});
