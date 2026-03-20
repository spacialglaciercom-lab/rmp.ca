import React, { ReactNode } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { recordErrorToCrashlytics } from "@/lib/crashlytics-report";
import { reportErrorToServer } from "@/lib/error-report";

interface MapErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
  fallback?: ReactNode;
}

interface MapErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error boundary specifically for map-related components
 * Handles map loading errors, tile errors, and navigation failures
 */
export class MapErrorBoundary extends React.Component<
  MapErrorBoundaryProps,
  MapErrorBoundaryState
> {
  constructor(props: MapErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<MapErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Map Error Boundary caught:", error, errorInfo);
    recordErrorToCrashlytics(error, "MapErrorBoundary", {
      component: "map",
      errorType: this.classifyMapError(error),
    });
    reportErrorToServer(error, {
      name: "MapErrorBoundary",
      isFatal: false,
    }).catch(() => {});

    this.setState({
      error,
      errorInfo,
    });
  }

  private classifyMapError(error: Error): string {
    const message = error.message.toLowerCase();
    if (message.includes("network") || message.includes("fetch")) {
      return "network";
    }
    if (message.includes("tile") || message.includes("map")) {
      return "tile";
    }
    if (message.includes("permission") || message.includes("location")) {
      return "permission";
    }
    return "unknown";
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
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <MapErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

/** Fixed colors for map error fallback */
const MAP_FALLBACK_COLORS = {
  background: "#1a1a1a",
  surface: "#2d2d2d",
  text: "#ffffff",
  muted: "#a0a0a0",
  error: "#f87171",
  primary: "#3b82f6",
  warning: "#f59e0b",
};

function MapErrorFallback({
  error,
  errorInfo,
  onReset,
}: {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  onReset: () => void;
}) {
  const isDev = __DEV__;
  const errorMessage = error?.message || "Unknown map error";

  const getErrorIcon = () => {
    const message = errorMessage.toLowerCase();
    if (message.includes("network") || message.includes("fetch")) {
      return "wifi-off";
    }
    if (message.includes("tile") || message.includes("map")) {
      return "map-off";
    }
    if (message.includes("permission") || message.includes("location")) {
      return "map-marker-off";
    }
    return "map-alert";
  };

  const getErrorDescription = () => {
    const message = errorMessage.toLowerCase();
    if (message.includes("network") || message.includes("fetch")) {
      return "Network connection issue. Please check your internet connection and try again.";
    }
    if (message.includes("tile") || message.includes("map")) {
      return "Map tiles failed to load. This may be a temporary issue with the map service.";
    }
    if (message.includes("permission") || message.includes("location")) {
      return "Location permission is required for map functionality. Please enable location access in settings.";
    }
    return "An unexpected error occurred while loading the map.";
  };

  return (
    <View
      className="flex-1 items-center justify-center p-6"
      style={{ backgroundColor: MAP_FALLBACK_COLORS.background }}
    >
      <View className="items-center mb-6">
        <MaterialCommunityIcons
          name={getErrorIcon()}
          size={64}
          color={MAP_FALLBACK_COLORS.error}
        />
        <Text
          className="text-2xl font-bold mt-4 mb-2"
          style={{ color: MAP_FALLBACK_COLORS.text }}
        >
          Map Error
        </Text>
        <Text
          className="text-center text-base mb-4 px-4"
          style={{ color: MAP_FALLBACK_COLORS.muted }}
        >
          {getErrorDescription()}
        </Text>
      </View>

      {isDev && (
        <View
          className="rounded-xl p-4 mb-6 w-full max-w-md"
          style={{ backgroundColor: MAP_FALLBACK_COLORS.surface }}
        >
          <Text
            className="text-sm font-mono mb-2"
            style={{ color: MAP_FALLBACK_COLORS.error }}
          >
            Error Details:
          </Text>
          <Text
            className="text-xs font-mono"
            selectable
            style={{ color: MAP_FALLBACK_COLORS.muted }}
          >
            {errorMessage}
          </Text>
          {error?.stack && (
            <Text
              className="text-xs font-mono mt-2"
              selectable
              style={{ color: MAP_FALLBACK_COLORS.muted }}
            >
              {error.stack.slice(0, 200)}...
            </Text>
          )}
        </View>
      )}

      <View className="flex-row gap-3 w-full max-w-md">
        <TouchableOpacity
          onPress={onReset}
          className="flex-1 py-3 rounded-xl"
          style={{ backgroundColor: MAP_FALLBACK_COLORS.primary }}
        >
          <Text
            className="text-center font-semibold"
            style={{ color: "#ffffff" }}
          >
            Retry
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            // In a real app, this could open settings or contact support
            console.log("Map help requested");
          }}
          className="flex-1 py-3 rounded-xl"
          style={{ backgroundColor: MAP_FALLBACK_COLORS.surface }}
        >
          <Text
            className="text-center font-semibold"
            style={{ color: MAP_FALLBACK_COLORS.text }}
          >
            Help
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
