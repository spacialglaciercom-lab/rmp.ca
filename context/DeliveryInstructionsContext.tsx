/**
 * DeliveryInstructionsContext — Load delivery instructions from a single JSON file.
 * Default instructions come from data/deliveryInstructions.json (loaded in _layout).
 * User can replace them by tapping "Load from JSON file" and selecting a file.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import instructionManager, {
  type DeliveryInstruction,
  type DeliveryInstructionsJson,
} from "@/services/InstructionManager";
import { readFileAsText } from "@/lib/readFileAsText";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

interface DeliveryInstructionsContextValue {
  /** Current list of instructions (synced from InstructionManager). */
  instructions: DeliveryInstruction[];
  /** Load instructions from a user-picked JSON file. Works on native (picker) and web (file input). */
  loadFromFile: () => Promise<void>;
  /** Error message from last load attempt, if any. */
  loadError: string | null;
  /** Clear the load error. */
  clearLoadError: () => void;
}

const DeliveryInstructionsContext =
  createContext<DeliveryInstructionsContextValue | null>(null);

function parseInstructionsJson(raw: string): DeliveryInstructionsJson {
  const data = JSON.parse(raw) as unknown;
  if (data == null || typeof data !== "object") {
    throw new Error("JSON must be an object");
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.instructions)) {
    throw new Error('JSON must have an "instructions" array');
  }
  const instructions = obj.instructions as unknown[];
  const valid: DeliveryInstruction[] = instructions
    .filter(
      (item): item is DeliveryInstruction =>
        item != null &&
        typeof item === "object" &&
        typeof (item as DeliveryInstruction).address === "string" &&
        typeof (item as DeliveryInstruction).title === "string" &&
        typeof (item as DeliveryInstruction).details === "string",
    )
    .map((item) => ({
      address: (item as DeliveryInstruction).address,
      title: (item as DeliveryInstruction).title,
      details: (item as DeliveryInstruction).details,
      ...((item as DeliveryInstruction).id != null && {
        id: (item as DeliveryInstruction).id,
      }),
      ...((item as DeliveryInstruction).priority != null && {
        priority: (item as DeliveryInstruction).priority,
      }),
    }));
  return { instructions: valid };
}

export function DeliveryInstructionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [instructions, setInstructions] = useState<DeliveryInstruction[]>(() =>
    instructionManager.getAll(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadFromFile = useCallback(async () => {
    try {
      hapticImpact();
      setLoadError(null);

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "*.json"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const file = result.assets[0];
      if (!file?.uri) {
        setLoadError("File URI not available");
        return;
      }

      const fileName = (file.name ?? "").toLowerCase();
      if (!fileName.endsWith(".json")) {
        setLoadError("Please select a JSON file (.json)");
        return;
      }

      let content: string;
      if (Platform.OS !== "web") {
        content = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } else {
        const assetWithFile = file as { file?: File; uri?: string };
        if (
          assetWithFile.file &&
          typeof (assetWithFile.file as Blob).slice === "function"
        ) {
          content = await readFileAsText(assetWithFile.file);
        } else if (file.uri) {
          const response = await fetch(file.uri);
          const blob = await response.blob();
          content = await readFileAsText(blob);
        } else {
          setLoadError("Could not read file");
          return;
        }
      }

      const data = parseInstructionsJson(content);
      instructionManager.importFromJson(data);
      setInstructions(instructionManager.getAll());
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load JSON";
      setLoadError(message);
      if (Platform.OS !== "web") {
        Alert.alert("Load instructions", message);
      }
    }
  }, []);

  const clearLoadError = useCallback(() => setLoadError(null), []);

  const value = useMemo<DeliveryInstructionsContextValue>(
    () => ({ instructions, loadFromFile, loadError, clearLoadError }),
    [instructions, loadFromFile, loadError, clearLoadError],
  );

  return (
    <DeliveryInstructionsContext.Provider value={value}>
      {children}
    </DeliveryInstructionsContext.Provider>
  );
}

export function useDeliveryInstructions(): DeliveryInstructionsContextValue {
  const ctx = useContext(DeliveryInstructionsContext);
  if (!ctx) {
    throw new Error(
      "useDeliveryInstructions must be used within DeliveryInstructionsProvider",
    );
  }
  return ctx;
}
