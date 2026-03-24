/**
 * RoutePreviewMap Component
 * 
 * Step 2 of route planning workflow:
 * - Display imported points as "Draft" pins on map
 * - Show route preview after solving
 * - Allow reordering and editing points
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/use-colors';
import { impactAsync } from '@/lib/safe-haptics';
import type { ImportPoint } from '@/hooks/useRouteImport';
import type { SolverResult, SolverOptions } from '@/lib/routeSolver';
import { solveRoute, estimateRouteStats } from '@/lib/routeSolver';

// Platform-specific map imports
let MapView: any, Marker: any, Polyline: any, Callout: any;
if (Platform.OS === 'web') {
  // Web: use react-native-maps web implementation
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    Polyline = Maps.Polyline;
    Callout = Maps.Callout;
  } catch {
    // Fallback for web
    MapView = View;
    Marker = View;
    Polyline = View;
    Callout = View;
  }
} else {
  // Native: use react-native-maps
  try {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    Polyline = Maps.Polyline;
    Callout = Maps.Callout;
  } catch {
    MapView = View;
    Marker = View;
    Polyline = View;
    Callout = View;
  }
}

export interface RoutePreviewPoint extends ImportPoint {
  sequence?: number;
  isDepot?: boolean;
}

interface RoutePreviewMapProps {
  points: RoutePreviewPoint[];
  depot?: RoutePreviewPoint;
  onPointsChange?: (points: RoutePreviewPoint[]) => void;
  onSolve?: (result: SolverResult) => void;
  onSave?: (points: RoutePreviewPoint[], result?: SolverResult) => Promise<void>;
  showSolveButton?: boolean;
  showSaveButton?: boolean;
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
}

const DRAFT_COLORS = {
  pin: '#FF9500', // Orange for draft pins
  depot: '#34C759', // Green for depot
  route: '#007AFF', // Blue for route line
  optimized: '#5856D6', // Purple for optimized route
};

export function RoutePreviewMap({
  points,
  depot,
  onPointsChange,
  onSolve,
  onSave,
  showSolveButton = true,
  showSaveButton = true,
  initialRegion,
}: RoutePreviewMapProps) {
  const colors = useColors();
  const router = useRouter();
  const [isSolving, setIsSolving] = useState(false);
  const [solveResult, setSolveResult] = useState<SolverResult | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [algorithm, setAlgorithm] = useState<SolverOptions['algorithm']>('2-opt');

  // Calculate initial region from points
  const region = useMemo(() => {
    if (initialRegion) return initialRegion;

    if (points.length === 0) {
      return {
        latitude: 45.5017,
        longitude: -73.5673,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
    }

    const stats = estimateRouteStats(points);
    const centerLat = (stats.boundingBox.minLat + stats.boundingBox.maxLat) / 2;
    const centerLon = (stats.boundingBox.minLon + stats.boundingBox.maxLon) / 2;
    const deltaLat = (stats.boundingBox.maxLat - stats.boundingBox.minLat) * 1.5 + 0.01;
    const deltaLon = (stats.boundingBox.maxLon - stats.boundingBox.minLon) * 1.5 + 0.01;

    return {
      latitude: centerLat,
      longitude: centerLon,
      latitudeDelta: Math.max(deltaLat, 0.01),
      longitudeDelta: Math.max(deltaLon, 0.01),
    };
  }, [points, initialRegion]);

  // Estimate stats for display
  const stats = useMemo(() => {
    const allPoints = depot ? [depot, ...points] : points;
    return estimateRouteStats(allPoints);
  }, [points, depot]);

  // Handle solve
  const handleSolve = useCallback(async () => {
    if (points.length === 0) {
      Alert.alert('No Points', 'Please import points first.');
      return;
    }

    setIsSolving(true);
    impactAsync();

    try {
      const allPoints = depot ? [depot, ...points] : points;
      const result = await solveRoute(allPoints, {
        algorithm,
        depot,
        returnToDepot: !!depot,
      });

      setSolveResult(result);

      // Update points with sequence
      if (onPointsChange) {
        const updatedPoints = result.orderedPoints.map((p, idx) => ({
          ...p,
          sequence: idx + 1,
          isDepot: depot?.id === p.id,
        }));
        onPointsChange(updatedPoints);
      }

      if (onSolve) {
        onSolve(result);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Solve Failed', errorMsg);
    } finally {
      setIsSolving(false);
    }
  }, [points, depot, algorithm, onPointsChange, onSolve]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (onSave) {
      impactAsync();
      await onSave(points, solveResult ?? undefined);
    }
  }, [points, solveResult, onSave]);

  // Render map markers
  const renderMarkers = useMemo(() => {
    const markers: React.ReactNode[] = [];
    const allPoints = depot ? [depot, ...points] : points;

    allPoints.forEach((point, idx) => {
      const sequence = solveResult
        ? solveResult.orderedPoints.findIndex(p => p.id === point.id) + 1
        : idx + 1;

      const isDepotPoint = depot?.id === point.id;
      const isSelected = selectedPoint === point.id;

      markers.push(
        <Marker
          key={point.id}
          coordinate={{
            latitude: point.lat,
            longitude: point.lon,
          }}
          title={point.name ?? `Point ${sequence}`}
          description={point.address ?? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`}
          onPress={() => setSelectedPoint(point.id)}
          pinColor={isDepotPoint ? DRAFT_COLORS.depot : DRAFT_COLORS.pin}
        >
          <View style={[
            styles.markerContainer,
            isDepotPoint && styles.depotMarker,
            isSelected && styles.selectedMarker,
          ]}>
            <Text style={styles.markerText}>
              {isDepotPoint ? 'D' : sequence}
            </Text>
          </View>
          <Callout>
            <View style={styles.callout}>
              <Text style={styles.calloutTitle}>{point.name ?? `Point ${sequence}`}</Text>
              {point.address && (
                <Text style={styles.calloutAddress}>{point.address}</Text>
              )}
              <Text style={styles.calloutCoords}>
                {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
              </Text>
              {point.demand !== undefined && (
                <Text style={styles.calloutDetail}>Demand: {point.demand}</Text>
              )}
              {point.serviceTime !== undefined && (
                <Text style={styles.calloutDetail}>Service: {point.serviceTime}s</Text>
              )}
            </View>
          </Callout>
        </Marker>
      );
    });

    return markers;
  }, [points, depot, solveResult, selectedPoint]);

  // Render route polyline
  const renderPolyline = useMemo(() => {
    if (!solveResult || solveResult.orderedPoints.length < 2) return null;

    const coordinates = solveResult.orderedPoints.map(p => ({
      latitude: p.lat,
      longitude: p.lon,
    }));

    return (
      <Polyline
        coordinates={coordinates}
        strokeColor={DRAFT_COLORS.optimized}
        strokeWidth={3}
        lineDashPattern={solveResult ? [] : [5, 5]}
      />
    );
  }, [solveResult]);

  // Format distance for display
  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // Format duration for display
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes} min`;
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={Platform.OS !== 'web'}
      >
        {renderMarkers}
        {renderPolyline}
      </MapView>

      {/* Stats overlay */}
      <View style={[styles.statsOverlay, { backgroundColor: colors.background + 'E6' }]}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {points.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              Points
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {formatDistance(stats.totalDistance)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              Est. Distance
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              {formatDuration(stats.estimatedDuration)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              Est. Duration
            </Text>
          </View>
        </View>
      </View>

      {/* Algorithm selector */}
      {showSolveButton && (
        <View style={[styles.algorithmRow, { backgroundColor: colors.background + 'E6' }]}>
          <Text style={[styles.algorithmLabel, { color: colors.muted }]}>
            Algorithm:
          </Text>
          {(['nearest-neighbor', '2-opt', 'pgrouting', 'vroom'] as const).map((algo) => (
            <TouchableOpacity
              key={algo}
              style={[
                styles.algorithmButton,
                algorithm === algo && { backgroundColor: colors.primary },
              ]}
              onPress={() => {
                setAlgorithm(algo);
                impactAsync();
              }}
            >
              <Text style={[
                styles.algorithmText,
                { color: algorithm === algo ? '#fff' : colors.foreground },
              ]}>
                {algo === 'nearest-neighbor' ? 'NN' : algo === '2-opt' ? '2-Opt' : algo}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {showSolveButton && (
          <TouchableOpacity
            style={[
              styles.solveButton,
              { backgroundColor: colors.primary },
              isSolving && { opacity: 0.6 },
            ]}
            onPress={handleSolve}
            disabled={isSolving || points.length === 0}
          >
            {isSolving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.solveButtonText}>
                {solveResult ? 'Re-solve Route' : 'Solve Route'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {showSaveButton && solveResult && (
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.success }]}
            onPress={handleSave}
          >
            <Text style={styles.saveButtonText}>Save Route</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legend */}
      <View style={[styles.legend, { backgroundColor: colors.background + 'E6' }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: DRAFT_COLORS.depot }]} />
          <Text style={[styles.legendText, { color: colors.foreground }]}>Depot</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: DRAFT_COLORS.pin }]} />
          <Text style={[styles.legendText, { color: colors.foreground }]}>Draft Point</Text>
        </View>
        {solveResult && (
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: DRAFT_COLORS.optimized }]} />
            <Text style={[styles.legendText, { color: colors.foreground }]}>Optimized Route</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
    minHeight: 300,
  },
  statsOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  algorithmRow: {
    position: 'absolute',
    top: 70,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 8,
    gap: 8,
  },
  algorithmLabel: {
    fontSize: 12,
    marginRight: 4,
  },
  algorithmButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(128, 128, 128, 0.2)',
  },
  algorithmText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    position: 'absolute',
    bottom: 20,
    left: 10,
    right: 10,
    flexDirection: 'row',
    gap: 10,
  },
  solveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  legend: {
    position: 'absolute',
    bottom: 80,
    left: 10,
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLine: {
    width: 20,
    height: 3,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
  },
  markerContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: DRAFT_COLORS.pin,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  depotMarker: {
    backgroundColor: DRAFT_COLORS.depot,
  },
  selectedMarker: {
    transform: [{ scale: 1.2 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  markerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  callout: {
    padding: 8,
    maxWidth: 200,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  calloutAddress: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  calloutCoords: {
    fontSize: 10,
    color: '#999',
    marginBottom: 4,
  },
  calloutDetail: {
    fontSize: 11,
    color: '#666',
  },
});