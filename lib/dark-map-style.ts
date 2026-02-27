/**
 * Dark monochrome map style (Radar-style) for Android Google Maps.
 * Used when user selects "Dark" in Settings > Map Type.
 * react-native-maps customMapStyle expects an array of MapStyleElement.
 */
export const DARK_MAP_STYLE_ANDROID = [
  { elementType: "geometry", stylers: [{ color: "#1a1a1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#404040" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e0e0e" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#404040" }] },
];
