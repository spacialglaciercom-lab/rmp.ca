/**
 * Voice Command Service — registers Moonshine intent triggers during
 * navigation and dispatches recognised commands to the app.
 *
 * On native (iOS/Android) this uses Moonshine's IntentRecognizer with
 * Gemma-300M semantic embeddings for fuzzy matching (e.g. "how much further"
 * matches the "distance remaining" trigger).
 *
 * On web, voice commands are not supported (no on-device transcription).
 *
 * Usage:
 *   import { VoiceCommandService } from "@/services/voiceCommandService";
 *
 *   const cmds = new VoiceCommandService();
 *   cmds.onCommand((intent) => handleIntent(intent));
 *   await cmds.activate();   // registers all navigation intents
 *   ...
 *   await cmds.deactivate(); // cleanup
 */
import { Platform } from "react-native";
import { createLogger } from "@/lib/logger";

const log = createLogger("VoiceCommands");

// ---------------------------------------------------------------------------
// Navigation intent definitions
// ---------------------------------------------------------------------------

export type NavIntent =
  | "NAV_NEXT_TURN"
  | "NAV_DISTANCE"
  | "NAV_CURRENT_STREET"
  | "NAV_STOP"
  | "NAV_SKIP_STOP"
  | "NAV_REPEAT"
  | "NAV_MUTE"
  | "COPILOT_ACTIVATE";

interface IntentDef {
  /** The phrase Moonshine's IntentRecognizer matches against (semantic, not exact). */
  triggerPhrase: string;
  /** Internal intent name dispatched to handler. */
  intent: NavIntent;
  /** Human-readable description for settings/help. */
  description: string;
}

export const NAVIGATION_INTENTS: IntentDef[] = [
  {
    triggerPhrase: "next turn",
    intent: "NAV_NEXT_TURN",
    description: "Announce the next maneuver",
  },
  {
    triggerPhrase: "distance remaining",
    intent: "NAV_DISTANCE",
    description: "How far to the next stop",
  },
  {
    triggerPhrase: "what street am I on",
    intent: "NAV_CURRENT_STREET",
    description: "Name the current street",
  },
  {
    triggerPhrase: "stop navigation",
    intent: "NAV_STOP",
    description: "End turn-by-turn navigation",
  },
  {
    triggerPhrase: "skip this stop",
    intent: "NAV_SKIP_STOP",
    description: "Skip the current collection point",
  },
  {
    triggerPhrase: "repeat that",
    intent: "NAV_REPEAT",
    description: "Repeat the last announcement",
  },
  {
    triggerPhrase: "mute voice",
    intent: "NAV_MUTE",
    description: "Toggle voice announcements",
  },
  {
    triggerPhrase: "hey copilot",
    intent: "COPILOT_ACTIVATE",
    description: "Activate AI co-pilot chat",
  },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type CommandHandler = (
  intent: NavIntent,
  utterance: string,
  similarity: number,
) => void;

export class VoiceCommandService {
  private handlers: CommandHandler[] = [];
  private active = false;
  private eventSubscription: { remove: () => void } | null = null;

  /**
   * Register a callback that fires when a voice command is recognised.
   * Returns an unsubscribe function.
   */
  onCommand(handler: CommandHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** Whether voice commands are currently listening. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Register all navigation intents and start listening.
   * Requires Moonshine streaming to be active (call after `startStreaming()`).
   */
  async activate(): Promise<void> {
    if (Platform.OS === "web") {
      log.debug("Voice commands not available on web");
      return;
    }
    if (this.active) return;

    try {
      // Dynamic import to avoid web bundle errors
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MoonshineVoice = require("@/modules/moonshine-voice").default;
      if (!MoonshineVoice.isAvailable() || !MoonshineVoice.isModelLoaded()) {
        log.debug("Moonshine not ready — skipping voice command registration");
        return;
      }

      // Register each intent
      for (const def of NAVIGATION_INTENTS) {
        await MoonshineVoice.registerIntent(def.triggerPhrase, def.intent);
      }

      // Listen for recognised intents
      this.eventSubscription = MoonshineVoice.addListener(
        "onIntentRecognized",
        (event: { intent: string; utterance: string; similarity: number }) => {
          log.debug("Intent recognised", event);
          for (const handler of this.handlers) {
            try {
              handler(
                event.intent as NavIntent,
                event.utterance,
                event.similarity,
              );
            } catch (err) {
              log.error(
                "Handler error",
                err instanceof Error ? err : new Error(String(err)),
              );
            }
          }
        },
      );

      this.active = true;
      log.debug("Voice commands activated", {
        intents: NAVIGATION_INTENTS.length,
      });
    } catch (err) {
      log.error(
        "Failed to activate voice commands",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * Unregister all intents and stop listening.
   */
  async deactivate(): Promise<void> {
    if (!this.active) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MoonshineVoice = require("@/modules/moonshine-voice").default;
      await MoonshineVoice.clearIntents();
    } catch {
      /* module may not be available */
    }

    this.eventSubscription?.remove();
    this.eventSubscription = null;
    this.active = false;
    log.debug("Voice commands deactivated");
  }

  /** Clean up (call on unmount). */
  destroy(): void {
    this.deactivate();
    this.handlers = [];
  }
}

/**
 * React hook helper — creates a VoiceCommandService that auto-cleans on unmount.
 *
 * Usage in a component:
 *   const cmds = useVoiceCommands((intent) => { ... });
 *   // activate/deactivate as needed
 */
export function createVoiceCommandService(): VoiceCommandService {
  return new VoiceCommandService();
}
