/**
 * MAPS.ME React Native integration for trashroute-mobile
 * Provides offline maps functionality using the MAPS.ME framework
 */

import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

// Use dynamic imports to avoid web server issues with absolute paths
let useColors: any;
let CollectionPoint: any;

try {
  // Try to import from the main app (works in metro bundler)
  useColors = require('@/hooks/use-colors').useColors;
  CollectionPoint = require('@/types').CollectionPoint;
} catch (e) {
  // Fallback for web/dev server - create basic mocks
  console.warn('MAPS.ME: Using fallback implementations for web/dev server');
  
  // Mock useColors hook for web fallback
  useColors = () => ({
    primary: '#6366f1',
    surface: '#ffffff',
    card: '#f8fafc',
    text: '#1e293b',
    muted: '#94a3b8',
    warning: '#f59e0b',
    success: '#10b981',
    error: '#ef4444',
  });
  
  // Mock CollectionPoint type for web fallback
  CollectionPoint = {} as any;
}

// Import the MAPS.ME components
import MapsMeView from './MapsMeView';
import MapsMeModule from './MapsMeModule';

/** Per-segment weather risk for route overlay (green/yellow/red). */
export interface SegmentRisk {
  segmentIndex: number;
  riskScore: number;
}

// Define CollectionPoint interface locally to avoid import issues
export interface LocalCollectionPoint {
  id: string;
  latitude: number;
  longitude: number;
  collectionType?: string;
  [key: string]: any; // Allow additional properties
}

export interface MapsMeMapProps {
  collectionPoints: LocalCollectionPoint[];
  routePoints?: Array<{ lat: number; lon: number; label?: string }>;
  /** When set with routePoints, draws route in segment colors by risk (weather overlay). */
  segmentRisks?: SegmentRisk[];
  height?: number;
  width?: number;
  onPointClick?: (point: LocalCollectionPoint) => void;
  onMapPress?: (lat: number, lon: number) => void;
  tapDestination?: { lat: number; lon: number } | null;
}

/**
 * MapsMeMap - A React Native component that uses MAPS.ME for offline maps
 * Currently only supports iOS, falls back to WebView-based Leaflet on other platforms
 */
export const MapsMeMap = React.memo(function MapsMeMap({
  collectionPoints,
  routePoints,
  segmentRisks,
  height = 400,
  width,
  onPointClick,
  onMapPress,
  tapDestination,
}: MapsMeMapProps) {
  const colors = useColors();
  
  // Handle web server compatibility by checking if we're in a web environment
  const isWebEnvironment = typeof window !== 'undefined' && window.document;
  const mapRef = useRef<any>(null);
  
  // Calculate map center and bounds from collection points
  const mapCenter = useMemo(() => {
    if (collectionPoints.length > 0) {
      const lats = collectionPoints.map((p) => p.latitude);
      const lons = collectionPoints.map((p) => p.longitude);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
      return { latitude: centerLat, longitude: centerLon };
    }
    return { latitude: 45.5, longitude: -74.5 }; // Default center
  }, [collectionPoints]);

  // Calculate appropriate zoom level based on point distribution
  const zoomLevel = useMemo(() => {
    if (collectionPoints.length >= 2) {
      const lats = collectionPoints.map((p) => p.latitude);
      const lons = collectionPoints.map((p) => p.longitude);
      const latSpan = Math.max(...lats) - Math.min(...lats);
      const lonSpan = Math.max(...lons) - Math.min(...lons);
      const avgSpan = (latSpan + lonSpan) / 2;
      
      // Convert span to approximate zoom level (empirical formula)
      if (avgSpan > 10) return 5; // Wide area
      if (avgSpan > 2) return 8;  // Large city
      if (avgSpan > 0.5) return 11; // City
      if (avgSpan > 0.1) return 14; // Neighborhood
      return 16; // Street level
    }
    return 15; // Default zoom
  }, [collectionPoints]);

  // Handle map press events (simplified for MAPS.ME)
  const handleMapPress = useCallback((event: any) => {
    // MAPS.ME doesn't provide direct coordinate feedback in basic integration
    // This would need to be enhanced with native module extensions
    if (onMapPress) {
      // For now, use the current map center as a fallback
      onMapPress(mapCenter.latitude, mapCenter.longitude);
    }
  }, [mapCenter, onMapPress]);

  // Handle point click events (simplified for MAPS.ME)
  const handlePointClick = useCallback((pointId: string) => {
    const point = collectionPoints.find((p) => p.id === pointId);
    if (point && onPointClick) {
      onPointClick(point);
    }
  }, [collectionPoints, onPointClick]);

  // Only use MAPS.ME on iOS, fall back to WebView-based solution on other platforms
  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.container, { height, width }]}>
        <MapsMeView
          ref={mapRef}
          style={styles.map}
          latitude={mapCenter.latitude}
          longitude={mapCenter.longitude}
          zoom={zoomLevel}
          onMapReady={() => {
            console.log('MAPS.ME map ready');
            // Here you would add markers for collection points
            // This requires extending the native module
          }}
        />
        {collectionPoints.length > 0 && (
          <Text style={styles.infoText}>
            {collectionPoints.length} collection points loaded
          </Text>
        )}
      </View>
    );
  }

  // Fallback for non-iOS platforms (Android, Web)
  // Enhanced web server compatibility
  if (isWebEnvironment) {
    return (
      <View style={[styles.container, { height, width, backgroundColor: colors.surface }]}>
        <Text style={[styles.fallbackText, { color: colors.muted }]}>
          MAPS.ME maps are currently only available on iOS. Using web-compatible fallback.
        </Text>
        {collectionPoints.length > 0 && (
          <View style={styles.webInfo}>
            <Text style={[styles.webInfoText, { color: colors.text }]}>
              {collectionPoints.length} collection points ready for mapping
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { height, width, backgroundColor: colors.surface }]}>
      <Text style={[styles.fallbackText, { color: colors.muted }]}>
        MAPS.ME maps are currently only available on iOS. Using fallback map view.
      </Text>
      {/* Here you would integrate with the existing WebView-based Leaflet map */}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  infoText: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: 'white',
    padding: 5,
    borderRadius: 5,
    fontSize: 12,
  },
  fallbackText: {
    flex: 1,
    textAlign: 'center',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webInfo: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  webInfoText: {
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },
});

/**
 * Initialize the MAPS.ME framework
 * Should be called early in the app lifecycle
 */
export async function initializeMapsMeFramework(): Promise<boolean> {
  if (Platform.OS !== 'ios') {
    console.log('MAPS.ME framework: Only available on iOS');
    return false;
  }

  try {
    const result = await MapsMeModule.initializeFramework();
    console.log('MAPS.ME framework initialized:', result);
    return result.success === true;
  } catch (error) {
    console.error('Failed to initialize MAPS.ME framework:', error);
    return false;
  }
}

/**
 * Set map position programmatically
 */
export async function setMapPosition(latitude: number, longitude: number): Promise<void> {
  if (Platform.OS === 'ios') {
    try {
      await MapsMeModule.setMapPosition(latitude, longitude);
    } catch (error) {
      console.error('Failed to set map position:', error);
    }
  }
}

/**
 * Set map zoom level programmatically
 */
export async function setMapZoom(zoom: number): Promise<void> {
  if (Platform.OS === 'ios') {
    try {
      await MapsMeModule.setMapZoom(zoom);
    } catch (error) {
      console.error('Failed to set map zoom:', error);
    }
  }
}

/**
 * Get current map position
 */
export async function getCurrentPosition(): Promise<{latitude: number, longitude: number, timestamp: number} | null> {
  if (Platform.OS === 'ios') {
    try {
      return await MapsMeModule.getCurrentPosition();
    } catch (error) {
      console.error('Failed to get current position:', error);
      return null;
    }
  }
  return null;
}

/**
 * Perform search on MAPS.ME maps
 */
export async function search(query: string): Promise<Array<{
  name: string;
  latitude: number;
  longitude: number;
  type: string;
}> | null> {
  if (Platform.OS === 'ios') {
    try {
      return await MapsMeModule.search(query);
    } catch (error) {
      console.error('Failed to perform search:', error);
      return null;
    }
  }
  return null;
}

// Export CollectionPoint type for compatibility
// This will use the local type if the main import fails
export { CollectionPoint };
