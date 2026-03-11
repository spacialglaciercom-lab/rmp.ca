/**
 * AccountSection — Sign in / Log out for TrashRoute account.
 *
 * Uses Firebase + Sign in with Apple on native. Required for hands-free voice:
 * speech is sent to the server for Whisper transcription, which needs a session token.
 * Web uses cookie-based auth and browser Speech Recognition; no sign-in needed.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getApiBaseUrl } from "@/shared/oauth";
import * as Auth from "@/lib/_core/auth";
import {
  signInWithAppleAndGetIdToken,
  preloadFirebaseAuth,
} from "@/lib/firebaseAppleSignIn";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export const AccountSection: React.FC = () => {
  const colors = useColors();
  const { user, loading, isAuthenticated, logout, refresh } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // Preload Firebase Auth when Settings is open so "Sign in" doesn't trigger a bundle load on tap
  useEffect(() => {
    if (Platform.OS !== "web") preloadFirebaseAuth();
  }, []);

  // Only show on iOS — web uses cookie-based auth, Android doesn't support Sign in with Apple
  if (Platform.OS !== "ios") {
    return null;
  }

  const handleSignIn = async () => {
    hapticImpact();
    setSigningIn(true);
    try {
      const idToken = await signInWithAppleAndGetIdToken();
      if (!idToken) {
        // User canceled
        setSigningIn(false);
        return;
      }

      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/firebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string })?.error ?? `Sign-in failed: ${res.status}`,
        );
      }

      const data = (await res.json()) as {
        sessionToken?: string;
        user?: {
          id?: number;
          openId?: string;
          name?: string | null;
          email?: string | null;
          loginMethod?: string | null;
          lastSignedIn?: string;
        };
      };
      if (data.sessionToken) {
        await Auth.setSessionToken(data.sessionToken);
        if (data.user) {
          await Auth.setUserInfo({
            id: data.user.id ?? 0,
            openId: data.user.openId ?? "",
            name: data.user.name ?? null,
            email: data.user.email ?? null,
            loginMethod: data.user.loginMethod ?? null,
            lastSignedIn: new Date(data.user.lastSignedIn ?? Date.now()),
          });
        }
        await refresh();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : String(
              (err as { message?: string })?.message ??
                "Could not sign in. Check your connection and try again.",
            );
      const isBundleError =
        msg.includes("Could not load bundle") ||
        msg.includes("LoadBundleFromServerRequestError") ||
        msg.includes("Sign-in couldn't load") ||
        (err as { name?: string })?.name === "LoadBundleFromServerRequestError";
      if (!isBundleError) console.error("[AccountSection] Sign in error:", err);
      Alert.alert("Sign-in failed", msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleLogout = () => {
    hapticImpact();
    Alert.alert(
      "Sign out",
      "Are you sure you want to sign out? Hands-free voice will stop working until you sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: logout },
      ],
    );
  };

  if (loading) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 14,
          gap: 10,
        }}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={{ fontSize: 15, color: colors.muted }}>
          Checking account...
        </Text>
      </View>
    );
  }

  if (isAuthenticated && user) {
    return (
      <View style={{ paddingVertical: 12, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.primary + "30",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons
              name="account-circle"
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontSize: 16, fontWeight: "600", color: colors.text }}
            >
              {user.name || user.email || "Signed in"}
            </Text>
            {user.email && user.name && (
              <Text
                style={{ fontSize: 13, color: colors.muted }}
                numberOfLines={1}
              >
                {user.email}
              </Text>
            )}
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              Hands-free voice enabled
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: colors.error + "15",
            gap: 8,
          }}
        >
          <MaterialCommunityIcons
            name="logout"
            size={18}
            color={colors.error}
          />
          <Text
            style={{ fontSize: 15, fontWeight: "600", color: colors.error }}
          >
            Sign out
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: 12 }}>
      <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 10 }}>
        Sign in with Apple to enable hands-free voice. Your speech is sent to
        the server for transcription.
      </Text>
      <TouchableOpacity
        onPress={handleSignIn}
        disabled={signingIn}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 12,
          borderRadius: 10,
          backgroundColor: signingIn ? colors.muted : colors.primary,
          gap: 8,
          opacity: signingIn ? 0.8 : 1,
        }}
      >
        {signingIn ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialCommunityIcons name="apple" size={22} color="#fff" />
        )}
        <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
          {signingIn ? "Signing in…" : "Sign in with Apple"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};
