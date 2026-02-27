/**
 * Privacy Policy screen. Available at /privacy (web and in-app).
 * Use this URL in App Store / Play Store and in-app links.
 */
import { View, Text, ScrollView, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";

const section = (title: string, body: string) => ({ title, body });

const SECTIONS = [
  section(
    "1. Information We Collect",
    "We collect: (a) Information you provide — e.g. account sign-in (e.g. Sign in with Apple), saved routes and preferences, and support messages. (b) Information collected automatically — device type, OS, app version, and location when you use mapping, routing, or weather. Location may be used in the background when the app is open. You can deny or revoke location in device settings. (c) Microphone and camera — only when you use voice/AI or camera-based features (e.g. Mapillary); we do not access them without your action. (d) Maps and routing — coordinates may be sent to map and routing providers to show maps and compute routes."
  ),
  section(
    "2. How We Use Information",
    "We use the information to provide and improve the app (routes, maps, weather, optimization), operate sign-in and account features, debug crashes, and comply with law. We do not sell your personal information."
  ),
  section(
    "3. Third-Party Services",
    "The app uses: Apple (Sign in with Apple), Google/Firebase (maps, analytics, crash reporting), Mapbox (maps/routing), OpenStreetMap and tile providers, weather and routing APIs, and possibly AI/chat providers. Each has its own privacy policy; we recommend reviewing them."
  ),
  section(
    "4. Data Retention",
    "On-device data stays until you clear app data or uninstall. Server/cloud data is retained while your account is active or as needed for support and legal obligations, then deleted or anonymized. Logs and diagnostics are kept only as long as necessary."
  ),
  section(
    "5. Your Rights and Choices",
    "You can turn off location for the app in device settings, sign out or delete your account where offered, and request access, correction, or deletion of your data by contacting us. In the EEA/UK you may have additional rights (e.g. portability, objection, complaint to a supervisor)."
  ),
  section(
    "6. Children",
    "The app is not directed at children under 13 (or higher where required). We do not knowingly collect personal information from children. If you believe a child has provided us data, contact us and we will delete it."
  ),
  section(
    "7. Security",
    "We use reasonable measures to protect your data. No system is completely secure; we cannot guarantee absolute security."
  ),
  section(
    "8. Changes",
    "We may update this policy and will post the updated version with a new \"Last updated\" date. Continued use after changes constitutes acceptance. We may notify you in the app or by email for material changes."
  ),
  section(
    "9. Contact",
    "For privacy questions, requests, or complaints, contact us at the email or support link provided in the app or on your website. Replace this with your actual contact details before publishing."
  ),
];

export default function PrivacyScreen() {
  const colors = useColors();
  const router = useRouter();

  return (
    <ScreenContainer style={{ backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {Platform.OS !== "web" && (
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12, padding: 4 }}>
            <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, flex: 1 }}>
          Privacy Policy
        </Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator
      >
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
          RouteMasterPro · Last updated: February 2026
        </Text>
        {SECTIONS.map(({ title, body }, i) => (
          <View key={i} style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 6 }}>
              {title}
            </Text>
            <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }}>
              {body}
            </Text>
          </View>
        ))}
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>
          Replace the contact details in Section 9 with your actual email or support URL before publishing.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
