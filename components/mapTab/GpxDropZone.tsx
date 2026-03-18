/**
 * Web-only overlay: drag-and-drop a GPX file on the map to view it and add waypoints to My Places.
 * Renders nothing on native (no desktop drop support).
 */

import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";

export interface GpxDropZoneProps {
  onGpxLoaded: (gpxText: string, fileName?: string) => void;
  children: React.ReactNode;
}

export function GpxDropZone({ onGpxLoaded, children }: GpxDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (Platform.OS !== "web") return;
      e.preventDefault();
      e.stopPropagation();
      const types = e.dataTransfer?.types ?? [];
      if (types.includes("Files")) {
        e.dataTransfer.dropEffect = "copy";
        setIsDragging(true);
      }
    },
    [],
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (Platform.OS !== "web") return;
    e.preventDefault();
    e.stopPropagation();
    // Only leave if we're actually leaving the drop zone (not entering a child)
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as HTMLDivElement;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (Platform.OS !== "web") return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      const gpxFile = Array.from(files).find(
        (f) => f.name.toLowerCase().endsWith(".gpx"),
      );
      if (!gpxFile) {
        return;
      }

      try {
        const text = await gpxFile.text();
        if (text?.trim()) {
          onGpxLoaded(text.trim(), gpxFile.name);
        }
      } catch (err) {
        console.error("Failed to read GPX file:", err);
      }
    },
    [onGpxLoaded],
  );

  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  // Wrapper receives drag/drop; overlay is visual-only (pointerEvents="none") so drop still hits wrapper
  return (
    <View
      style={StyleSheet.absoluteFill}
      onDragOver={handleDragOver as any}
      onDragLeave={handleDragLeave as any}
      onDrop={handleDrop as any}
    >
      {children}
      {isDragging && (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.message}>
            <Text style={styles.messageTitle}>Drop GPX file</Text>
            <Text style={styles.messageSub}>
              View on map & add to My Places
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  message: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
  },
  messageTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
  },
  messageSub: {
    fontSize: 14,
    color: "#555",
    marginTop: 4,
  },
});
