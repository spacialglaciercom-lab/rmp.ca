import React, { ReactNode } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";
import { reportErrorToServer } from "@/lib/error-report";

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error boundary component for catching and recovering from crashes
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    recordErrorToCrashlytics(error, "ErrorBoundary");
    reportErrorToServer(error, { name: "ErrorBoundary" }).catch(() => {});
    this.setState({
      error,
      errorInfo,
    });

    // In development, rethrow after a tick so the dev overlay (LogBox / red box) also shows the error
    if (__DEV__) {
      const err = error;
      const info = errorInfo;
      setTimeout(() => {
        console.error(
          "[ErrorBoundary] Rethrowing so dev tools show this error:",
          err.message,
        );
        if (err && typeof err === "object" && "stack" in err) {
          (err as Error & { componentStack?: string }).componentStack =
            info?.componentStack ?? undefined;
        }
        throw err;
      }, 0);
    }

    if (process.env.NODE_ENV === "production") {
      console.error("Error boundary caught:", error);
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

/** Fixed colors for error fallback so we never depend on theme (avoids secondary crashes) */
const FALLBACK_COLORS = {
  background: "#1a1a1a",
  surface: "#2d2d2d",
  text: "#ffffff",
  muted: "#a0a0a0",
  error: "#f87171",
  primary: "#3b82f6",
};

/**
 * Error fallback UI — uses fixed colors so it never throws if theme is broken.
 * In __DEV__ shows full stack so dev tools have everything in-app too.
 */
function ErrorFallback({
  error,
  errorInfo,
  onReset,
}: {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  onReset: () => void;
}) {
  const isDev = __DEV__;

  return (
    <View
      className="flex-1 p-4"
      style={{ backgroundColor: FALLBACK_COLORS.background }}
    >
      <ScrollView className="flex-1" style={{ flex: 1 }}>
        <View className="mt-8 mb-6">
          <Text
            className="text-3xl font-bold mb-2"
            style={{ color: FALLBACK_COLORS.error }}
          >
            ⚠️ Something went wrong
          </Text>
          <Text
            className="text-base mb-4"
            style={{ color: FALLBACK_COLORS.muted }}
          >
            The app encountered an error and needs to recover.
          </Text>
        </View>

        <View
          className="rounded-2xl p-4 mb-6"
          style={{ backgroundColor: FALLBACK_COLORS.surface }}
        >
          <Text
            className="text-sm font-mono mb-2"
            style={{ color: FALLBACK_COLORS.error }}
          >
            Error Details:
          </Text>
          <Text
            className="text-xs font-mono"
            selectable
            style={{ color: FALLBACK_COLORS.muted }}
          >
            {error?.message || "Unknown error"}
          </Text>
          {isDev && error?.stack && (
            <>
              <Text
                className="text-sm font-mono mt-3 mb-1"
                style={{ color: FALLBACK_COLORS.error }}
              >
                Stack:
              </Text>
              <Text
                className="text-xs font-mono"
                selectable
                style={{ marginBottom: 8, color: FALLBACK_COLORS.muted }}
              >
                {error.stack}
              </Text>
            </>
          )}
          {isDev && errorInfo?.componentStack && (
            <>
              <Text
                className="text-sm font-mono mb-1"
                style={{ color: FALLBACK_COLORS.error }}
              >
                Component stack:
              </Text>
              <Text
                className="text-xs font-mono"
                selectable
                style={{ color: FALLBACK_COLORS.muted }}
              >
                {errorInfo.componentStack}
              </Text>
            </>
          )}
        </View>

        <View className="mb-4">
          <Text
            className="text-sm font-semibold mb-2"
            style={{ color: FALLBACK_COLORS.text }}
          >
            What you can do:
          </Text>
          <Text
            className="text-sm mb-2"
            style={{ color: FALLBACK_COLORS.muted }}
          >
            • Try resetting the app by tapping the button below
          </Text>
          <Text
            className="text-sm mb-2"
            style={{ color: FALLBACK_COLORS.muted }}
          >
            • Close and reopen the app if the issue persists
          </Text>
          <Text className="text-sm" style={{ color: FALLBACK_COLORS.muted }}>
            • Contact support if the problem continues
          </Text>
        </View>
      </ScrollView>

      <TouchableOpacity
        onPress={onReset}
        className="py-4 rounded-xl mb-4"
        style={{ backgroundColor: FALLBACK_COLORS.primary }}
      >
        <Text
          className="text-center font-semibold"
          style={{ color: "#ffffff" }}
        >
          Reset App
        </Text>
      </TouchableOpacity>
    </View>
  );
}
