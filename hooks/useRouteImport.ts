/**
 * useRouteImport Hook
 * 
 * Step 1-2 of route planning workflow:
 * - Import file (CSV, GeoJSON, GPX) using react-native-document-picker
 * - Convert to JSON format for preview
 * - Support multiple import formats
 */
import { useState, useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Alert } from 'react-native';
import { parseGPXForNavigation } from '@/lib/gpxNavParser';
import { parseGeoJSON, importGeoJSONRoute } from '@/lib/geojson-import';
import { parseRouteCSV } from '@/lib/route-import/csvRoute';
import { featureCollectionToImportPoints } from '@/lib/route-import/geojsonPoints';
import { normalizePointType, type ParsedRoutePoint } from '@/lib/route-import/pointTypes';

export type ImportPoint = ParsedRoutePoint;

export interface ImportResult {
  points: ImportPoint[];
  fileName: string;
  fileType: 'csv' | 'geojson' | 'gpx' | 'json';
  totalPoints: number;
  warnings: string[];
  depot?: ImportPoint;
}

export interface ImportProgress {
  stage: 'idle' | 'picking' | 'reading' | 'parsing' | 'validating' | 'complete' | 'error';
  progress: number;
  message: string;
  error?: string;
}

/**
 * Parse JSON file (can be array of points or CVRP format)
 */
function parseRouteJSON(content: string): { points: ImportPoint[], warnings: string[], depot?: ImportPoint } {
  const data = JSON.parse(content);
  const warnings: string[] = [];
  let points: ImportPoint[] = [];
  let depot: ImportPoint | undefined;

  // CVRP format: { type: "CVRP", capacity: number, depot_id?: number, nodes: [...] }
  if (data.type === 'CVRP' && Array.isArray(data.nodes)) {
    points = data.nodes.map((node: any, idx: number) => ({
      id: `cvrp-${idx}`,
      lat: node.lat ?? node.latitude,
      lon: node.lon ?? node.longitude ?? node.lng,
      name: node.name ?? node.label,
      demand: node.demand ?? node.capacity,
      type: data.depot_id === node.id ? 'depot' : 'bin',
    }));

    // Find depot if specified
    if (data.depot_id !== undefined) {
      const depotNode = data.nodes.find((n: any) => n.id === data.depot_id);
      if (depotNode) {
        depot = {
          id: `depot-${data.depot_id}`,
          lat: depotNode.lat ?? depotNode.latitude,
          lon: depotNode.lon ?? depotNode.longitude ?? depotNode.lng,
          name: depotNode.name ?? 'Depot',
          type: 'depot',
        };
      }
    }
  }
  // Simple array format: [{ lat, lon, name, ... }]
  else if (Array.isArray(data)) {
    points = data.map((item: any, idx: number) => ({
      id: item.id ?? `json-${idx}`,
      lat: item.lat ?? item.latitude,
      lon: item.lon ?? item.longitude ?? item.lng,
      name: item.name ?? item.label,
      address: item.address,
      type: normalizePointType(item.type),
      demand: item.demand ?? item.capacity,
      serviceTime: item.serviceTime ?? item.service_time ?? item.duration,
      notes: item.notes,
      timeWindow: (item.timeWindow ?? item.time_window)
        ? {
            start: item.timeWindow?.start ?? item.time_window?.start,
            end: item.timeWindow?.end ?? item.time_window?.end,
          }
        : undefined,
    }));
  }
  // GeoJSON FeatureCollection
  else if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    points = featureCollectionToImportPoints(data);
  }
  else {
    throw new Error('Unsupported JSON format. Expected CVRP, array of points, or GeoJSON FeatureCollection.');
  }

  return { points, warnings, depot };
}

/**
 * Parse GPX file for waypoints
 */
async function parseRouteGPX(content: string): Promise<{ points: ImportPoint[], warnings: string[] }> {
  const result = await parseGPXForNavigation(content);
  const points: ImportPoint[] = [];
  const warnings: string[] = [];

  if (result.waypoints) {
    result.waypoints.forEach((wp: any, idx: number) => {
      points.push({
        id: `gpx-wpt-${idx}`,
        lat: wp.lat ?? wp.latitude,
        lon: wp.lon ?? wp.longitude,
        name: wp.name,
        type: 'waypoint',
      });
    });
  }

  if (result.trackPoints && result.trackPoints.length > 0) {
    warnings.push('GPX track points converted to waypoints (may lose detail)');
    // Sample track points to avoid too many
    const step = Math.max(1, Math.floor(result.trackPoints.length / 100));
    for (let i = 0; i < result.trackPoints.length; i += step) {
      const tp = result.trackPoints[i];
      points.push({
        id: `gpx-trk-${i}`,
        lat: tp.lat ?? tp.latitude,
        lon: tp.lon ?? tp.longitude,
        name: tp.name ?? `Point ${Math.floor(i / step) + 1}`,
        type: 'waypoint',
      });
    }
  }

  return { points, warnings };
}

/**
 * Main hook for route import workflow
 */
export function useRouteImport() {
  const [progress, setProgress] = useState<ImportProgress>({
    stage: 'idle',
    progress: 0,
    message: 'Ready to import',
  });
  const [result, setResult] = useState<ImportResult | null>(null);

  const importFile = useCallback(async (): Promise<ImportResult | null> => {
    setProgress({ stage: 'picking', progress: 10, message: 'Opening file picker...' });

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'application/csv',
          'application/json',
          'application/geo+json',
          'application/gpx+xml',
          'application/xml',
          'text/plain',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (pickerResult.canceled || !pickerResult.assets?.[0]) {
        setProgress({ stage: 'idle', progress: 0, message: 'Import cancelled' });
        return null;
      }

      const file = pickerResult.assets[0];
      if (!file.uri) {
        throw new Error('File URI not available');
      }

      setProgress({ stage: 'reading', progress: 20, message: 'Reading file...' });

      // Read file content
      let content: string;
      const fileName = (file.name ?? '').toLowerCase();

      if (Platform.OS === 'web') {
        // Web: use fetch or FileReader
        if (file.uri.startsWith('blob:') || file.uri.startsWith('data:')) {
          const response = await fetch(file.uri);
          content = await response.text();
        } else {
          const response = await fetch(file.uri);
          content = await response.text();
        }
      } else {
        // Native: use FileSystem
        content = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      setProgress({ stage: 'parsing', progress: 40, message: 'Parsing file...' });

      let points: ImportPoint[] = [];
      let warnings: string[] = [];
      let depot: ImportPoint | undefined;
      let fileType: ImportResult['fileType'] = 'json';

      // Detect file type and parse
      if (fileName.endsWith('.csv') || fileName.endsWith('.tsv')) {
        fileType = 'csv';
        const parsed = parseRouteCSV(content);
        points = parsed.points;
        warnings = parsed.warnings;
      } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
        fileType = 'json';
        // Try JSON first, then GeoJSON
        try {
          const parsed = parseRouteJSON(content);
          points = parsed.points;
          warnings = parsed.warnings;
          depot = parsed.depot;
        } catch {
          // Try as GeoJSON import
          const geoResult = await importGeoJSONRoute(content);
          points = geoResult.points.map((p, idx) => ({
            id: `geojson-${idx}`,
            lat: p.lat,
            lon: p.lon,
            name: p.name,
            type: 'waypoint' as const,
          }));
        }
      } else if (fileName.endsWith('.gpx') || fileName.endsWith('.xml')) {
        fileType = 'gpx';
        const parsed = await parseRouteGPX(content);
        points = parsed.points;
        warnings = parsed.warnings;
      } else {
        // Try to auto-detect format
        const trimmed = content.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          fileType = 'json';
          const parsed = parseRouteJSON(content);
          points = parsed.points;
          warnings = parsed.warnings;
          depot = parsed.depot;
        } else if (trimmed.includes(',') && trimmed.includes('\n')) {
          fileType = 'csv';
          const parsed = parseRouteCSV(content);
          points = parsed.points;
          warnings = parsed.warnings;
        } else {
          throw new Error('Unsupported file format. Please use CSV, JSON, or GPX.');
        }
      }

      setProgress({ stage: 'validating', progress: 80, message: 'Validating points...' });

      // Validate points
      const validPoints = points.filter(p => {
        if (isNaN(p.lat) || isNaN(p.lon)) {
          warnings.push(`Point ${p.id}: Invalid coordinates`);
          return false;
        }
        if (p.lat < -90 || p.lat > 90) {
          warnings.push(`Point ${p.id}: Latitude out of range`);
          return false;
        }
        if (p.lon < -180 || p.lon > 180) {
          warnings.push(`Point ${p.id}: Longitude out of range`);
          return false;
        }
        return true;
      });

      if (validPoints.length === 0) {
        throw new Error('No valid points found in file');
      }

      const importResult: ImportResult = {
        points: validPoints,
        fileName: file.name ?? 'imported',
        fileType,
        totalPoints: validPoints.length,
        warnings,
        depot,
      };

      setResult(importResult);
      setProgress({ stage: 'complete', progress: 100, message: `Imported ${validPoints.length} points` });

      return importResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setProgress({ stage: 'error', progress: 0, message: 'Import failed', error: errorMsg });
      Alert.alert('Import Error', errorMsg);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setProgress({ stage: 'idle', progress: 0, message: 'Ready to import' });
    setResult(null);
  }, []);

  return {
    progress,
    result,
    importFile,
    reset,
  };
}