/**
 * Web-compatible fallback for MapsMeModule
 * This prevents "cannot read properties of undefined" errors in web development server
 */

import { Platform } from 'react-native';

// Web-compatible mock implementation
class MapsMeModuleWeb {
  static async initializeFramework(): Promise<{success: boolean, message: string}> {
    console.log('MAPS.ME: Web fallback - framework initialization not available');
    return { success: false, message: 'MAPS.ME is only available on native platforms' };
  }

  static async setMapPosition(latitude: number, longitude: number): Promise<void> {
    console.log(`MAPS.ME: Web fallback - setMapPosition(${latitude}, ${longitude}) not available`);
  }

  static async setMapZoom(zoom: number): Promise<void> {
    console.log(`MAPS.ME: Web fallback - setMapZoom(${zoom}) not available`);
  }

  static async getCurrentPosition(): Promise<{latitude: number, longitude: number, timestamp: number} | null> {
    console.log('MAPS.ME: Web fallback - getCurrentPosition not available');
    return null;
  }

  static async search(query: string): Promise<Array<{
    name: string;
    latitude: number;
    longitude: number;
    type: string;
  }>> {
    console.log(`MAPS.ME: Web fallback - search("${query}") not available`);
    return [];
  }
}

// Check if we're in a web environment and export the web-compatible version
if (typeof window !== 'undefined' || Platform.OS === 'web') {
  // In web environment, use the mock implementation to prevent errors
  module.exports = MapsMeModuleWeb;
} else {
  // In native environment, use the real native module
  const { NativeModules } = require('react-native');
  module.exports = NativeModules.MapsMeViewManager || MapsMeModuleWeb;
}