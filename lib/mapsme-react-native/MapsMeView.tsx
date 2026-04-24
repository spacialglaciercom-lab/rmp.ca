import React, { useEffect, useRef } from "react";
import { requireNativeComponent, Platform } from "react-native";

// Use dynamic import to handle web compatibility
let MapsMeModule: any;
let MapsMeView: any;

try {
  // Try to load the native component (works in native environments)
  MapsMeView = requireNativeComponent("MapsMeView");
  MapsMeModule = require("./MapsMeModule").default;
} catch (e) {
  // In web environment, use fallback implementations
  console.warn("MAPS.ME: Using web-compatible fallback for MapsMeView");

  // Mock MapsMeView component for web
  MapsMeView = ({ style, ...props }: any) => (
    <div
      style={{
        ...style,
        backgroundColor: "#f0f0f0",
        borderRadius: 8,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <p style={{ color: "#666", textAlign: "center", padding: 20 }}>
        MAPS.ME maps are only available on native platforms
      </p>
    </div>
  );

  // Mock MapsMeModule for web
  MapsMeModule = {
    initializeFramework: async () => ({
      success: false,
      message: "Web not supported",
    }),
    setMapPosition: async () => {},
    setMapZoom: async () => {},
    getCurrentPosition: async () => null,
    search: async () => [],
  };
}

interface MapsMeViewProps {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  onMapReady?: (event: any) => void;
  style?: any;
}

const MapsMeReactView: React.FC<MapsMeViewProps> = ({
  latitude = 40.7128,
  longitude = -74.006,
  zoom = 15.0,
  onMapReady,
  ...rest
}) => {
  const viewRef = useRef<any>(null);
  const props = { latitude, longitude, zoom, onMapReady, ...rest };

  useEffect(() => {
    // Initialize the framework when component mounts
    const initialize = async () => {
      try {
        await MapsMeModule.initializeFramework();
        console.log("MAPS.ME framework initialized");
      } catch (error) {
        console.error("Failed to initialize MAPS.ME framework:", error);
      }
    };

    initialize();

    return () => {
      // Cleanup if needed
    };
  }, []);

  useEffect(() => {
    // Update map position when props change
    if (
      props.latitude !== undefined &&
      props.longitude !== undefined &&
      viewRef.current
    ) {
      MapsMeModule.setMapPosition(props.latitude, props.longitude);
    }
  }, [props.latitude, props.longitude]);

  useEffect(() => {
    // Update map zoom when props change
    if (props.zoom !== undefined && viewRef.current) {
      MapsMeModule.setMapZoom(props.zoom);
    }
  }, [props.zoom]);

  const handleMapReady = (event: any) => {
    if (props.onMapReady) {
      props.onMapReady(event.nativeEvent);
    }
  };

  return <MapsMeView ref={viewRef} {...props} onMapReady={handleMapReady} />;
};

export default MapsMeReactView;
