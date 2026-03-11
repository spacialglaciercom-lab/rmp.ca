/**
 * Report JS errors to the backend so they can trigger Expo Push notifications to devs.
 * Used from the global error handler and unhandled rejection handler.
 */

import { getApiBaseUrl } from "@/shared/oauth";
import Constants from "expo-constants";
import { Platform } from "react-native";

export async function reportErrorToServer(
  error: Error,
  context?: { name?: string; isFatal?: boolean },
): Promise<void> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return;

  const payload = {
    message: error?.message ?? String(error),
    stack: error?.stack,
    appVersion:
      Constants.expoConfig?.version ?? Constants.manifest?.version ?? "1.0.0",
    platform: Platform.OS,
    ...(context?.name && { name: context.name }),
    ...(context?.isFatal !== undefined && { isFatal: context.isFatal }),
  };

  try {
    await fetch(`${baseUrl}/api/report-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Avoid throwing; reporting is best-effort
  }
}
