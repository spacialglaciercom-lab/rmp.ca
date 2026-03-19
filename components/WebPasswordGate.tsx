/**
 * Web-only password gate for Vercel (or any web) deployment.
 * On web, visitors must enter the correct password before seeing the app.
 * Native builds are not gated.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";

const COOKIE_NAME = "trashroute_web_access";
const COOKIE_MAX_AGE_DAYS = 7;

// Override with EXPO_PUBLIC_WEB_APP_PASSWORD in Vercel to avoid committing a different password.
const EXPECTED_PASSWORD =
  (typeof process !== "undefined" &&
    process.env?.EXPO_PUBLIC_WEB_APP_PASSWORD) ||
  "Arm&hammer94";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/([.*+?^${}()|[\]\\])/g, "\\$1") + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function WebPasswordGate({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (Platform.OS !== "web") {
      setUnlocked(true);
      return;
    }
    setUnlocked(getCookie(COOKIE_NAME) === "1");
  }, []);

  const submit = useCallback(() => {
    if (password.trim() === EXPECTED_PASSWORD) {
      setCookie(COOKIE_NAME, "1");
      setError("");
      setUnlocked(true);
    } else {
      setError("Incorrect password.");
    }
  }, [password]);

  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  if (unlocked === null) {
    return (
      <View style={[styles.centered, style]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  if (unlocked) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.centered, styles.form, style]}>
      <Text style={styles.title}>Enter password</Text>
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          setError("");
        }}
        onSubmitEditing={submit}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text
        style={styles.button}
        onPress={submit}
      >
        Continue
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f172a",
  },
  loading: {
    color: "#94a3b8",
    fontSize: 16,
  },
  form: {
    padding: 24,
  },
  title: {
    color: "#f1f5f9",
    fontSize: 20,
    marginBottom: 16,
    fontWeight: "600",
  },
  input: {
    width: "100%",
    maxWidth: 280,
    height: 48,
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 8,
    paddingHorizontal: 16,
    color: "#f1f5f9",
    fontSize: 16,
    marginBottom: 12,
  },
  error: {
    color: "#f87171",
    fontSize: 14,
    marginBottom: 8,
  },
  button: {
    color: "#38bdf8",
    fontSize: 16,
    fontWeight: "600",
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
});
