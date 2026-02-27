/**
 * Register this device's Expo push token with the API so the server can send error alerts.
 *
 * Expo: getExpoPushTokenAsync returns { data: tokenString, type: "expo" }. The backend uses
 * the token string to call Expo Push API (https://exp.host/--/api/v2/push/send). Token is
 * tied to the app's projectId and should be discarded if you get DeviceNotRegistered.
 */

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { getApiBaseUrl } from "@/shared/oauth";

export interface RegisterPushOptions {
  /** Optional: associate this device with a user (stored on server for future use). */
  userId?: string;
}

export async function registerForPushNotificationsAsync(
  options?: RegisterPushOptions
): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (existingStatus !== "granted") {
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    status = newStatus;
  }
  if (status !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const tokenResult = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  const expoPushToken = tokenResult.data;

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return expoPushToken;

  try {
    await fetch(`${baseUrl}/api/register-push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expoPushToken,
        ...(options?.userId != null && { userId: options.userId }),
      }),
    });
  } catch {
    // Best-effort; return token so caller can still use it (e.g. share)
  }

  return expoPushToken;
}
