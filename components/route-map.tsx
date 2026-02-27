/**
 * Barrel for route-map. Metro resolves route-map-impl to .native (react-native-maps) or .web (Leaflet) by platform.
 * Do not re-export from "./route-map.native" here or web will load native-only modules and crash.
 */
export { RouteMap, type RouteMapProps, type RouteMapRef } from "./route-map-impl";
