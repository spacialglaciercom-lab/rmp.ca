/**
 * StreetViewPreview — WEB stub.
 * Street View requires react-native-maps + react-native-webview (native only).
 * Metro resolves to this file on web so the native module is never loaded.
 */

import React from "react";

interface StreetViewPreviewProps {
  points: { lat: number; lon: number }[];
  isVisible: boolean;
  onClose: () => void;
  trackName?: string;
}

export function StreetViewPreview(_props: StreetViewPreviewProps) {
  return null;
}
