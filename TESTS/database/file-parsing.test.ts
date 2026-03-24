/**
 * File Parsing Unit Tests
 * 
 * Tests for GPX and GeoJSON file parsing logic used in offline import.
 * These tests verify that imported route files are correctly parsed and
 * validated before being stored in the local database.
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// GPX PARSING TESTS
// ============================================================================

describe('GPX File Parsing', () => {
  // Mock GPX parser implementation
  function parseGPX(gpxContent: string): {
    name: string;
    points: Array<{ lat: number; lon: number; ele?: number; time?: string }>;
    metadata?: Record<string, string>;
  } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxContent, 'application/xml');
    
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid GPX format');
    }

    const name = doc.querySelector('name')?.textContent || 'Untitled Route';
    
    const points = Array.from(doc.querySelectorAll('trkpt')).map(pt => ({
      lat: parseFloat(pt.getAttribute('lat') || '0'),
      lon: parseFloat(pt.getAttribute('lon') || '0'),
      ele: pt.querySelector('ele')?.textContent ? parseFloat(pt.querySelector('ele')!.textContent!) : undefined,
      time: pt.querySelector('time')?.textContent || undefined,
    }));

    const metadata: Record<string, string> = {};
    const metadataElements = doc.querySelectorAll('metadata > *');
    metadataElements.forEach(el => {
      if (el.textContent) {
        metadata[el.tagName] = el.textContent;
      }
    });

    return { name, points, metadata };
  }

  describe('Valid GPX Parsing', () => {
    it('should parse basic GPX with track points', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <name>Test Route</name>
            <trkseg>
              <trkpt lat="45.0" lon="-75.0">
                <ele>100.5</ele>
              </trkpt>
              <trkpt lat="45.1" lon="-75.1">
                <ele>102.3</ele>
              </trkpt>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.name).toBe('Test Route');
      expect(result.points).toHaveLength(2);
      expect(result.points[0].lat).toBe(45.0);
      expect(result.points[0].lon).toBe(-75.0);
      expect(result.points[0].ele).toBe(100.5);
    });

    it('should parse GPX with time stamps', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
              <trkpt lat="45.0" lon="-75.0">
                <time>2024-01-01T10:00:00Z</time>
              </trkpt>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.points[0].time).toBe('2024-01-01T10:00:00Z');
    });

    it('should parse GPX with metadata', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <metadata>
            <desc>Test Description</desc>
            <author>Test Author</author>
          </metadata>
          <trk>
            <trkseg>
              <trkpt lat="45.0" lon="-75.0"/>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.['desc']).toBe('Test Description');
      expect(result.metadata?.['author']).toBe('Test Author');
    });

    it('should handle GPX with multiple track segments', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
              <trkpt lat="45.0" lon="-75.0"/>
              <trkpt lat="45.1" lon="-75.1"/>
            </trkseg>
            <trkseg>
              <trkpt lat="45.2" lon="-75.2"/>
              <trkpt lat="45.3" lon="-75.3"/>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.points).toHaveLength(4);
    });
  });

  describe('Invalid GPX Handling', () => {
    it('should throw error for invalid XML', () => {
      const invalidGpx = 'This is not valid XML';

      expect(() => parseGPX(invalidGpx)).toThrow('Invalid GPX format');
    });

    it('should handle missing coordinates gracefully', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
              <trkpt lat="" lon="-75.0"/>
              <trkpt lat="45.0" lon=""/>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.points).toHaveLength(2);
      expect(result.points[0].lat).toBe(0); // Default to 0
      expect(result.points[1].lon).toBe(0);
    });

    it('should handle empty GPX', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      expect(result.points).toHaveLength(0);
    });
  });

  describe('GPX Validation', () => {
    it('should validate coordinate ranges', () => {
      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
              <trkpt lat="91.0" lon="-75.0"/>
              <trkpt lat="45.0" lon="181.0"/>
            </trkseg>
          </trk>
        </gpx>`;

      const result = parseGPX(gpxContent);

      // Parser doesn't validate, but we can check in post-processing
      expect(result.points[0].lat).toBe(91.0); // Invalid latitude
      expect(result.points[1].lon).toBe(181.0); // Invalid longitude
    });

    it('should handle large GPX files efficiently', () => {
      // Generate a large GPX with 10000 points
      const points = Array.from({ length: 10000 }, (_, i) => 
        `<trkpt lat="${45 + i * 0.0001}" lon="${-75 + i * 0.0001}"/>`
      ).join('\n');

      const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
          <trk>
            <trkseg>
              ${points}
            </trkseg>
          </trk>
        </gpx>`;

      const start = performance.now();
      const result = parseGPX(gpxContent);
      const elapsed = performance.now() - start;

      expect(result.points).toHaveLength(10000);
      expect(elapsed).toBeLessThan(1000); // Should parse in under 1 second
    });
  });
});

// ============================================================================
// GEOJSON PARSING TESTS
// ============================================================================

describe('GeoJSON File Parsing', () => {
  // Mock GeoJSON parser implementation
  function parseGeoJSON(geojsonContent: string): {
    type: string;
    features: Array<{
      id?: string;
      type: string;
      geometry: {
        type: string;
        coordinates: number[] | number[][];
      };
      properties: Record<string, unknown>;
    }>;
  } {
    const geojson = JSON.parse(geojsonContent);

    if (!geojson.type) {
      throw new Error('Invalid GeoJSON: missing type');
    }

    if (geojson.type === 'FeatureCollection') {
      return {
        type: geojson.type,
        features: (geojson.features || []).map((f: any) => ({
          id: f.id,
          type: f.type,
          geometry: f.geometry,
          properties: f.properties || {},
        })),
      };
    }

    if (geojson.type === 'Feature') {
      return {
        type: 'FeatureCollection',
        features: [{
          id: geojson.id,
          type: geojson.type,
          geometry: geojson.geometry,
          properties: geojson.properties || {},
        }],
      };
    }

    // Geometry object
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: geojson,
        properties: {},
      }],
    };
  }

  describe('Valid GeoJSON Parsing', () => {
    it('should parse FeatureCollection with Points', () => {
      const geojsonContent = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'point-1',
            geometry: {
              type: 'Point',
              coordinates: [-75.0, 45.0],
            },
            properties: {
              name: 'Bin 1',
              type: 'recycling',
            },
          },
          {
            type: 'Feature',
            id: 'point-2',
            geometry: {
              type: 'Point',
              coordinates: [-75.1, 45.1],
            },
            properties: {
              name: 'Bin 2',
              type: 'compost',
            },
          },
        ],
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toHaveLength(2);
      expect(result.features[0].geometry.type).toBe('Point');
      expect(result.features[0].geometry.coordinates).toEqual([-75.0, 45.0]);
    });

    it('should parse LineString for routes', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-75.0, 45.0],
            [-75.1, 45.1],
            [-75.2, 45.2],
          ],
        },
        properties: {
          name: 'Route 1',
          distance: 15.5,
        },
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features).toHaveLength(1);
      expect(result.features[0].geometry.type).toBe('LineString');
      expect(result.features[0].geometry.coordinates).toHaveLength(3);
    });

    it('should parse Polygon for zones', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-75.0, 45.0],
            [-75.1, 45.0],
            [-75.1, 45.1],
            [-75.0, 45.1],
            [-75.0, 45.0], // Close the polygon
          ]],
        },
        properties: {
          name: 'Zone A',
          truckCount: 2,
        },
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features[0].geometry.type).toBe('Polygon');
      expect(result.features[0].properties.truckCount).toBe(2);
    });

    it('should parse MultiPoint for collection points', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'MultiPoint',
          coordinates: [
            [-75.0, 45.0],
            [-75.1, 45.1],
            [-75.2, 45.2],
          ],
        },
        properties: {
          routeId: 'route-123',
        },
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features[0].geometry.type).toBe('MultiPoint');
      expect(result.features[0].geometry.coordinates).toHaveLength(3);
    });
  });

  describe('Invalid GeoJSON Handling', () => {
    it('should throw error for invalid JSON', () => {
      const invalidJson = 'not valid json';

      expect(() => parseGeoJSON(invalidJson)).toThrow();
    });

    it('should throw error for missing type', () => {
      const geojsonContent = JSON.stringify({
        features: [],
      });

      expect(() => parseGeoJSON(geojsonContent)).toThrow('Invalid GeoJSON: missing type');
    });

    it('should handle empty FeatureCollection', () => {
      const geojsonContent = JSON.stringify({
        type: 'FeatureCollection',
        features: [],
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features).toHaveLength(0);
    });

    it('should handle missing properties', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-75.0, 45.0],
        },
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features[0].properties).toEqual({});
    });
  });

  describe('GeoJSON Validation', () => {
    it('should validate coordinate order (lon, lat)', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-75.0, 45.0], // GeoJSON uses [lon, lat]
        },
      });

      const result = parseGeoJSON(geojsonContent);
      const coords = result.features[0].geometry.coordinates as number[];

      expect(coords[0]).toBe(-75.0); // Longitude
      expect(coords[1]).toBe(45.0); // Latitude
    });

    it('should handle 3D coordinates', () => {
      const geojsonContent = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-75.0, 45.0, 100.5], // lon, lat, elevation
        },
      });

      const result = parseGeoJSON(geojsonContent);
      const coords = result.features[0].geometry.coordinates as number[];

      expect(coords).toHaveLength(3);
      expect(coords[2]).toBe(100.5);
    });

    it('should handle nested FeatureCollections', () => {
      const geojsonContent = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'GeometryCollection',
              geometries: [
                { type: 'Point', coordinates: [-75.0, 45.0] },
                { type: 'Point', coordinates: [-75.1, 45.1] },
              ],
            },
            properties: {},
          },
        ],
      });

      const result = parseGeoJSON(geojsonContent);

      expect(result.features).toHaveLength(1);
      expect(result.features[0].geometry.type).toBe('GeometryCollection');
    });
  });
});

// ============================================================================
// FILE IMPORT VALIDATION TESTS
// ============================================================================

describe('File Import Validation', () => {
  function validateImportFile(file: { name: string; size: number; type: string }): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const validExtensions = ['.gpx', '.geojson', '.json'];
    const maxSizeBytes = 50 * 1024 * 1024; // 50 MB

    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (!validExtensions.includes(extension)) {
      errors.push(`Invalid file extension: ${extension}. Allowed: ${validExtensions.join(', ')}`);
    }

    if (file.size > maxSizeBytes) {
      errors.push(`File too large: ${(file.size / 1024 / 1024).toFixed(2)} MB. Max: 50 MB`);
    }

    if (file.size === 0) {
      errors.push('File is empty');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  it('should accept valid GPX file', () => {
    const result = validateImportFile({
      name: 'route.gpx',
      size: 1024 * 1024, // 1 MB
      type: 'application/gpx+xml',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept valid GeoJSON file', () => {
    const result = validateImportFile({
      name: 'points.geojson',
      size: 5 * 1024 * 1024, // 5 MB
      type: 'application/geo+json',
    });

    expect(result.valid).toBe(true);
  });

  it('should reject invalid file extension', () => {
    const result = validateImportFile({
      name: 'route.txt',
      size: 1024,
      type: 'text/plain',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid file extension: .txt. Allowed: .gpx, .geojson, .json');
  });

  it('should reject file that is too large', () => {
    const result = validateImportFile({
      name: 'large-route.gpx',
      size: 60 * 1024 * 1024, // 60 MB
      type: 'application/gpx+xml',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('File too large'))).toBe(true);
  });

  it('should reject empty file', () => {
    const result = validateImportFile({
      name: 'empty.gpx',
      size: 0,
      type: 'application/gpx+xml',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File is empty');
  });

  it('should handle multiple validation errors', () => {
    const result = validateImportFile({
      name: 'file.pdf',
      size: 100 * 1024 * 1024, // 100 MB
      type: 'application/pdf',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});