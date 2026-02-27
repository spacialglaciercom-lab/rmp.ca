/**
 * GeneralChatContext — State management for the general-purpose AI chat.
 *
 * Independent of the driving co-pilot. No route context, no voice input.
 * Uses OpenRouter (auto best-free) with Mistral fallback.
 * TTS: ElevenLabs (if enabled) → expo-speech fallback.
 */
import React, { createContext, useContext, useReducer, useCallback } from "react";
import type { GeneralChatMessage } from "@/services/generalChatService";

// ── Types ───────────────────────────────────────────────────────────────────

export type GeneralChatStatus = "idle" | "processing" | "speaking";

interface GeneralChatState {
  status: GeneralChatStatus;
  messages: GeneralChatMessage[];
  isOverlayOpen: boolean;
  error: string | null;
}

type GeneralChatAction =
  | { type: "SET_STATUS"; status: GeneralChatStatus }
  | { type: "ADD_MESSAGE"; message: GeneralChatMessage }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "TOGGLE_OVERLAY"; open?: boolean }
  | { type: "CLEAR_MESSAGES" };

interface GeneralChatContextType {
  state: GeneralChatState;
  sendMessage: (text: string) => Promise<void>;
  toggleOverlay: (open?: boolean) => void;
  clearMessages: () => void;
  stopSpeaking: () => Promise<void>;
}

// ── Reducer ─────────────────────────────────────────────────────────────────

const initialState: GeneralChatState = {
  status: "idle",
  messages: [],
  isOverlayOpen: false,
  error: null,
};

function reducer(state: GeneralChatState, action: GeneralChatAction): GeneralChatState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status, error: null };
    case "ADD_MESSAGE":
      const msgs = [...state.messages, action.message].slice(-50);
      return { ...state, messages: msgs };
    case "SET_ERROR":
      return { ...state, error: action.error, status: "idle" };
    case "TOGGLE_OVERLAY":
      return { ...state, isOverlayOpen: action.open ?? !state.isOverlayOpen };
    case "CLEAR_MESSAGES":
      return { ...state, messages: [] };
    default:
      return state;
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

const GeneralChatCtx = createContext<GeneralChatContextType | undefined>(undefined);

export const GeneralChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    dispatch({ type: "ADD_MESSAGE", message: { role: "user", content: text.trim() } });
    dispatch({ type: "SET_STATUS", status: "processing" });

    try {
      const { sendGeneralChatMessage } = await import("@/services/generalChatService");
      const history = state.messages.slice(-20);

      const { reply, provider } = await sendGeneralChatMessage(text.trim(), history);

      dispatch({ type: "ADD_MESSAGE", message: { role: "assistant", content: reply } });

      if (provider === "fallback") {
        dispatch({ type: "SET_ERROR", error: reply });
      } else {
        // Speak the response via TTS (ElevenLabs if enabled, else expo-speech)
        dispatch({ type: "SET_STATUS", status: "speaking" });
        try {
          const { speakResponse } = await import("@/services/coPilotAudioService");
          await speakResponse(reply);
        } catch {
          // TTS failed silently — user still sees text
        }
        dispatch({ type: "SET_STATUS", status: "idle" });
      }
    } catch (error) {
      console.error("[GeneralChat] sendMessage error:", error);
      dispatch({ type: "SET_ERROR", error: "Something went wrong. Try again." });
    }
  }, [state.messages]);

  const toggleOverlay = useCallback((open?: boolean) => {
    dispatch({ type: "TOGGLE_OVERLAY", open });
  }, []);

  const clearMessages = useCallback(() => {
    dispatch({ type: "CLEAR_MESSAGES" });
  }, []);

  const stopSpeaking = useCallback(async () => {
    try {
      const { stopSpeaking: stopTts } = await import("@/services/coPilotAudioService");
      await stopTts();
      dispatch({ type: "SET_STATUS", status: "idle" });
    } catch {
      dispatch({ type: "SET_STATUS", status: "idle" });
    }
  }, []);

  return (
    <GeneralChatCtx.Provider
      value={{
        state,
        sendMessage,
        toggleOverlay,
        clearMessages,
        stopSpeaking,
      }}
    >
      {children}
    </GeneralChatCtx.Provider>
  );
};

export const useGeneralChat = () => {
  const context = useContext(GeneralChatCtx);
  if (!context) throw new Error("useGeneralChat must be used within GeneralChatProvider");
  return context;
};
