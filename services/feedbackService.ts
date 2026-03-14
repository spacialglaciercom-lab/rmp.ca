/**
 * Feedback Service - Sends product feedback via Resend email API.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

// Set EXPO_PUBLIC_RESEND_API_KEY in .env (never commit real key). Prefer server-side proxy in production.
const RESEND_API_KEY = process.env.EXPO_PUBLIC_RESEND_API_KEY ?? "";
const FROM_EMAIL = "RouteMaster Pro <contact@routemasterpro.ca>";
const FEEDBACK_EMAIL = process.env.EXPO_PUBLIC_FEEDBACK_EMAIL ?? "droneservivesqc@proton.me";

interface IssueReport {
  category: string;
  description: string;
  deviceInfo?: string;
}

interface SuggestionReport {
  description: string;
  screenshotBase64?: string;
  /** Optional file attachment (e.g. PDF); when present, sent as email attachment. */
  attachment?: { name: string; base64: string; mimeType: string };
  deviceInfo?: string;
}

/**
 * Collect device info using only Platform and Constants to avoid pulling in
 * expo-device or other native modules that can trigger NativeEventEmitter
 * crashes (e.g. PushNotificationIOS null on Android) when reporting errors.
 */
function getDeviceInfo(): string {
  try {
    const info = [
      `Platform: ${Platform.OS} ${Platform.Version ?? "unknown"}`,
      `App Version: ${Constants.expoConfig?.version ?? Constants.manifest?.version ?? "unknown"}`,
    ];
    return info.join("\n");
  } catch {
    return "Device info unavailable";
  }
}

export async function submitIssueReport(report: IssueReport): Promise<boolean> {
  try {
    if (!RESEND_API_KEY?.trim()) {
      console.warn("[FeedbackService] EXPO_PUBLIC_RESEND_API_KEY not set; skipping send");
      return false;
    }
    const deviceInfo = report.deviceInfo ?? getDeviceInfo();

    const htmlContent = `
      <h2>Issue Report</h2>
      <p><strong>Category:</strong> ${report.category}</p>
      <h3>Description:</h3>
      <p>${report.description.replace(/\n/g, "<br>")}</p>
      <hr>
      <h4>Device Information:</h4>
      <pre>${deviceInfo}</pre>
      <p><em>Submitted at: ${new Date().toISOString()}</em></p>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [FEEDBACK_EMAIL],
        subject: `[Issue Report] ${report.category}`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FeedbackService] Failed to send issue report:", error);
      return false;
    }

    console.log("[FeedbackService] Issue report sent successfully");
    return true;
  } catch (error) {
    console.error("[FeedbackService] Error sending issue report:", error);
    return false;
  }
}

export async function submitSuggestion(
  report: SuggestionReport,
): Promise<boolean> {
  try {
    if (!RESEND_API_KEY?.trim()) {
      console.warn("[FeedbackService] EXPO_PUBLIC_RESEND_API_KEY not set; skipping send");
      return false;
    }
    const deviceInfo = report.deviceInfo ?? getDeviceInfo();

    let htmlContent = `
      <h2>Feature Suggestion</h2>
      <h3>Description:</h3>
      <p>${report.description.replace(/\n/g, "<br>")}</p>
    `;

    if (report.screenshotBase64) {
      htmlContent += `
        <h3>Screenshot:</h3>
        <img src="data:image/jpeg;base64,${report.screenshotBase64}" style="max-width: 600px; border: 1px solid #ccc;" />
      `;
    }

    htmlContent += `
      <hr>
      <h4>Device Information:</h4>
      <pre>${deviceInfo}</pre>
      <p><em>Submitted at: ${new Date().toISOString()}</em></p>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [FEEDBACK_EMAIL],
        subject: "[Feature Suggestion] New idea submitted",
        html: htmlContent,
        ...(report.attachment && {
          attachments: [
            {
              filename: report.attachment.name,
              content: report.attachment.base64,
            },
          ],
        }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FeedbackService] Failed to send suggestion:", error);
      return false;
    }

    console.log("[FeedbackService] Suggestion sent successfully");
    return true;
  } catch (error) {
    console.error("[FeedbackService] Error sending suggestion:", error);
    return false;
  }
}
