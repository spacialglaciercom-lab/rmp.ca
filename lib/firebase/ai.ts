/**
 * Firebase AI Logic client — RouteMaster PRO Constraint Parser.
 *
 * Uses @react-native-firebase/ai (Gemini 2.0 Flash via GoogleAI backend)
 * to parse natural language dispatcher instructions into structured
 * constraint rules the optimization engine can consume.
 *
 * Native (dev build): uses @react-native-firebase/ai directly.
 * Web / Expo Go: uses the `firebase` JS SDK's firebase/ai module.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import type { ParsedConstraintResult } from "@/types/routeMasterConstraint";

// ── System prompt (RouteMaster PRO Capability 3) ──────────────────────────

const CONSTRAINT_SYSTEM_PROMPT = `You are the RouteMaster PRO Constraint Parser — an expert at interpreting natural language route constraints for municipal trash collection operations.

When a dispatcher types a constraint, instruction, or rule in plain English, parse it into a structured JSON object.

SUPPORTED CONSTRAINT TYPES:
- skip: Do not service a street/area (e.g. "Skip Elm St on Tuesdays")
- avoid: Route around but may still service nearby (e.g. "Avoid Main St during school hours")
- time_window: Service only during specific hours (e.g. "Only do Oak Ave before 7am")
- direction: Force travel direction (e.g. "Always go northbound on 1st St")
- priority: Service early in the route (e.g. "Hit the hospital first every day")
- delay: Postpone service (e.g. "Push Zone 3 to Thursday this week")
- frequency: Change collection frequency (e.g. "Maple Dr needs twice a week now")
- vehicle: Assign specific truck/type (e.g. "Send the small truck to Cedar Lane")
- crew: Assign specific driver/team (e.g. "Mike knows the downtown route best")
- seasonal: Constraint active only in certain seasons (e.g. "Extra pass on leaf streets Oct-Dec")
- temporary: Time-limited constraint (e.g. "Road closed on 5th Ave until March")
- permanent: Ongoing rule (e.g. "Never go down the alley behind the school")
- capacity: Volume/weight limits (e.g. "Zone 7 fills the truck — plan a dump run mid-route")
- special_instruction: Any other operational note (e.g. "Honk twice at the gate on Industrial Blvd")

PARSING RULES:
- Extract the street name, zone, or area referenced
- Identify the constraint type from the list above
- Detect any temporal qualifiers (days, times, dates, seasons, "until", "starting from")
- Detect any conditional qualifiers ("if raining", "when school is in session", "during construction")
- Infer whether the constraint is temporary or permanent
- Assign a confidence score (0.0 to 1.0) for your interpretation
- If the input is ambiguous, provide your best interpretation AND flag the ambiguity
- If a single input contains multiple constraints, parse each one separately

IMPORTANT: Respond with ONLY valid JSON matching this exact schema (no markdown, no explanation outside JSON):
{
  "analysis_type": "constraint_parsing",
  "original_input": "<the raw text>",
  "parsed_constraints": [
    {
      "id": "<short unique id like c1, c2, etc>",
      "type": "<constraint type>",
      "target": {
        "street": "<street name or null>",
        "zone": "<zone id or null>",
        "area": "<area description or null>",
        "coordinates": null
      },
      "schedule": {
        "days": ["<day list or null>"],
        "time_start": "<HH:MM or null>",
        "time_end": "<HH:MM or null>",
        "effective_date": "<YYYY-MM-DD or null>",
        "expiration_date": "<YYYY-MM-DD or null>",
        "season": "<season or null>",
        "recurring": true or false
      },
      "conditions": ["<conditional qualifiers if any>"],
      "parameters": {},
      "permanent": true or false,
      "reason": "<extracted or inferred reason>",
      "priority": "low | medium | high | critical",
      "confidence": 0.0-1.0,
      "ambiguities": ["<anything unclear>"],
      "dispatcher_confirmation_needed": true or false
    }
  ],
  "conflicts_detected": [],
  "summary": "<human-readable summary of what was parsed>"
}`;

// ── Lazy-loaded AI instance ───────────────────────────────────────────────

let _modelPromise: Promise<{
  generateContent: (
    prompt: string,
  ) => Promise<{ response: { text: () => string } }>;
}> | null = null;

function getModel() {
  if (_modelPromise) return _modelPromise;

  _modelPromise = (async () => {
    const isExpoGo = Constants.appOwnership === "expo";

    if (Platform.OS !== "web" && !isExpoGo) {
      // Native dev build: use @react-native-firebase/ai
      try {
        const {
          getAI,
          getGenerativeModel,
          GoogleAIBackend,
        } = require("@react-native-firebase/ai");
        const ai = getAI(undefined, { backend: new GoogleAIBackend() });
        return getGenerativeModel(ai, {
          model: "gemini-2.0-flash",
          systemInstruction: CONSTRAINT_SYSTEM_PROMPT,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        });
      } catch (e) {
        console.warn(
          "[FirebaseAI] Native module not available, trying JS SDK:",
          (e as Error).message,
        );
      }
    }

    // Web / Expo Go fallback: use firebase JS SDK
    try {
      const {
        initializeApp,
        getApps,
        getApp: getExistingApp,
      } = require("firebase/app");
      const {
        getAI: getAIWeb,
        getGenerativeModel: getGenModelWeb,
        GoogleAIBackend: GoogleAIBackendWeb,
      } = require("firebase/ai");

      // Reuse existing JS app or create one for AI
      let app;
      const existingApps = getApps();
      const aiApp = existingApps.find(
        (a: { name: string }) => a.name === "trashroute-ai",
      );
      if (aiApp) {
        app = aiApp;
      } else {
        // Web config from Firebase Console — same project as native (trashroutemobile)
        app = initializeApp(
          {
            apiKey: process.env.EXPO_PUBLIC_FIREBASE_AI_API_KEY || "",
            projectId: "trashroutemobile",
            appId: "1:970176642480:web:placeholder", // Replace with actual web app ID from Firebase Console
          },
          "trashroute-ai",
        );
      }

      const ai = getAIWeb(app, { backend: new GoogleAIBackendWeb() });
      return getGenModelWeb(ai, {
        model: "gemini-2.0-flash",
        systemInstruction: CONSTRAINT_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      });
    } catch (e) {
      console.error(
        "[FirebaseAI] JS SDK fallback failed:",
        (e as Error).message,
      );
      throw new Error(
        "Firebase AI not available. Use a native dev build or set EXPO_PUBLIC_FIREBASE_AI_API_KEY for web.",
      );
    }
  })();

  return _modelPromise;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Parse a natural language constraint into structured rules using Gemini 2.0 Flash.
 *
 * @param input - Dispatcher's natural language instruction
 *   e.g. "Skip Elm Street on Tuesdays — school zone"
 * @returns Parsed constraint result with structured rules
 */
export async function parseConstraint(
  input: string,
): Promise<ParsedConstraintResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Constraint input cannot be empty.");
  }

  const model = await getModel();
  const result = await model.generateContent(trimmed);
  const text = result.response.text();

  // Parse and validate
  let parsed: ParsedConstraintResult;
  try {
    parsed = JSON.parse(text) as ParsedConstraintResult;
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!parsed.parsed_constraints || !Array.isArray(parsed.parsed_constraints)) {
    throw new Error("Gemini response missing parsed_constraints array.");
  }

  // Ensure original_input is set
  parsed.original_input = trimmed;
  parsed.analysis_type = "constraint_parsing";

  return parsed;
}

/** Reset the cached model (e.g. if Firebase config changes). */
export function resetFirebaseAIModel(): void {
  _modelPromise = null;
}
