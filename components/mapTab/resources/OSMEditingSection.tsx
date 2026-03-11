/**
 * OSM Editing plugin — sign in to OpenStreetMap (OAuth 2.0).
 * Shown in Maps & Resources next to the Mapillary / Map & widgets section.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { SectionLabel } from "@/components/minimal";
import { OsmAuthService } from "@/lib/osmAuthService";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";

export function OSMEditingSection() {
  const colors = useColors();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  const loadStatus = async () => {
    if (!OsmAuthService.isConfigured()) {
      setDisplayName(null);
      setLoading(false);
      return;
    }
    try {
      const name = await OsmAuthService.getDisplayName();
      setDisplayName(name);
    } catch {
      setDisplayName(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleSignIn = async () => {
    if (!OsmAuthService.isConfigured()) {
      const redirectUri = OsmAuthService.getRedirectUri();
      Alert.alert(
        "OSM not configured",
        `Add EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID and EXPO_PUBLIC_OSM_OAUTH_CLIENT_SECRET to .env. In your OSM OAuth2 application (https://www.openstreetmap.org/oauth2/applications) set Redirect URI to ${redirectUri}`,
      );
      return;
    }
    if (Platform.OS !== "web") hapticImpact();
    setSigningIn(true);
    try {
      const name = await OsmAuthService.login();
      setDisplayName(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed.";
      Alert.alert("OpenStreetMap sign-in failed", msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (Platform.OS !== "web") hapticImpact();
    await OsmAuthService.logout();
    setDisplayName(null);
  };

  const configured = OsmAuthService.isConfigured();

  return (
    <View style={[styles.section, { paddingVertical: 4 }]}>
      <SectionLabel
        color={colors.primary}
        style={{ marginTop: 20, marginBottom: 12 }}
      >
        OpenStreetMap
      </SectionLabel>
      <Text style={[styles.description, { color: colors.muted }]}>
        Sign in to use OSM editing (notes, user preferences). Placed here next
        to Mapillary settings.
      </Text>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={styles.loader}
        />
      ) : !configured ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Set EXPO_PUBLIC_OSM_OAUTH_CLIENT_ID and client secret in .env to
          enable. In your OSM OAuth2 app set Redirect URI to{" "}
          {OsmAuthService.getRedirectUri()}.
        </Text>
      ) : displayName ? (
        <View style={styles.row}>
          <Text
            style={[styles.signedIn, { color: colors.text }]}
            numberOfLines={1}
          >
            Signed in as {displayName}
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.muted + "40" }]}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>
              Sign out
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleSignIn}
          disabled={signingIn}
          activeOpacity={0.7}
        >
          {signingIn ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.buttonText, { color: "#fff" }]}>
              Sign in to OpenStreetMap
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    fontStyle: "italic",
  },
  loader: {
    marginVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  signedIn: {
    flex: 1,
    fontSize: 15,
    minWidth: 0,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 120,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
