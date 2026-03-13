# MAPS.ME React Native Integration

This module provides MAPS.ME offline maps functionality for the trashroute-mobile project.

## Overview

The MAPS.ME React Native integration provides:

- **Offline Maps**: Access to comprehensive offline map data
- **Native Performance**: Uses the MAPS.ME framework for optimal performance
- **React Native Components**: Easy-to-use React components
- **iOS Support**: Full support for iOS devices (Android support planned)

## Installation

### Prerequisites

1. **React Native Development Environment**: Ensure you have React Native CLI and dependencies installed
2. **MAPS.ME Framework**: This integration depends on the MAPS.ME native framework
3. **CocoaPods**: Required for iOS dependency management
4. **Xcode**: For iOS development
5. **Expo Development Build**: Required for native modules

### Setup Steps

1. **Ensure the module is in place**:

   ```bash
   # The module should be at lib/mapsme-react-native/
   ls -la lib/mapsme-react-native/
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Run the iOS app with MAPS.ME integration**:

   ```bash
   npx expo run:ios
   ```

4. **For development builds (required for native modules)**:
   ```bash
   eas build --platform ios --profile development
   ```

## Usage

### Basic Map View

```typescript
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { MapsMeMap } from './index';
import type { CollectionPoint } from '@/types';

const collectionPoints: CollectionPoint[] = [
  { id: '1', latitude: 40.7128, longitude: -74.0060, collectionType: 'recycling' },
  { id: '2', latitude: 40.7306, longitude: -73.9352, collectionType: 'trash' },
];

const App = () => {
  return (
    <SafeAreaView style={styles.container}>
      <MapsMeMap
        collectionPoints={collectionPoints}
        height={400}
        width="100%"
        onPointClick={(point) => console.log('Point clicked:', point)}
        onMapPress={(lat, lon) => console.log('Map pressed at:', lat, lon)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
```

### Using the Native Module

```typescript
import React, { useEffect } from 'react';
import { View, Button } from 'react-native';
import {
  initializeMapsMeFramework,
  setMapPosition,
  getCurrentPosition,
  search
} from './index';

const MapControlExample = () => {
  useEffect(() => {
    // Initialize the framework when component mounts
    const init = async () => {
      try {
        const success = await initializeMapsMeFramework();
        console.log('Framework initialized:', success);

        if (success) {
          const position = await getCurrentPosition();
          console.log('Current position:', position);
        }
      } catch (error) {
        console.error('Initialization error:', error);
      }
    };

    init();
  }, []);

  const goToLocation = async () => {
    try {
      await setMapPosition(37.7749, -122.4194); // San Francisco
    } catch (error) {
      console.error('Navigation error:', error);
    }
  };

  const performSearch = async () => {
    try {
      const results = await search('restaurant');
      console.log('Search results:', results);
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  return (
    <View style={{flex: 1, padding: 20}}>
      <Button title="Go to San Francisco" onPress={goToLocation} />
      <Button title="Search" onPress={performSearch} />
    </View>
  );
};

export default MapControlExample;
```

## API Reference

### MapsMeMap Component

**Props:**

| Prop               | Type                                             | Description                           | Default                        |
| ------------------ | ------------------------------------------------ | ------------------------------------- | ------------------------------ | ------ |
| `collectionPoints` | `CollectionPoint[]`                              | Array of collection points to display | `[]`                           |
| `routePoints`      | `{ lat: number; lon: number; label?: string }[]` | Route points for path display         | `undefined`                    |
| `segmentRisks`     | `SegmentRisk[]`                                  | Weather risk data for route segments  | `undefined`                    |
| `height`           | `number`                                         | Map height                            | `400`                          |
| `width`            | `number`                                         | Map width                             | `undefined` (flex)             |
| `onPointClick`     | `(point: CollectionPoint) => void`               | Callback when a point is clicked      | `undefined`                    |
| `onMapPress`       | `(lat: number, lon: number) => void`             | Callback when map is pressed          | `undefined`                    |
| `tapDestination`   | `{ lat: number; lon: number }                    | null`                                 | Destination for tap navigation | `null` |

### MapsMeModule

**Methods:**

#### `initializeMapsMeFramework(): Promise<boolean>`

Initializes the MAPS.ME framework.

**Returns:** `Promise<boolean>` - `true` if initialization succeeded

#### `setMapPosition(latitude: number, longitude: number): Promise<void>`

Sets the map center to the specified coordinates.

**Parameters:**

- `latitude`: Latitude coordinate
- `longitude`: Longitude coordinate

#### `setMapZoom(zoom: number): Promise<void>`

Sets the map zoom level.

**Parameters:**

- `zoom`: Zoom level (typically 1-20)

#### `getCurrentPosition(): Promise<{latitude: number, longitude: number, timestamp: number} | null>`

Gets the current map position.

**Returns:** Current position or `null` if not available

#### `search(query: string): Promise<Array<{name: string, latitude: number, longitude: number, type: string}> | null>`

Performs a search query.

**Parameters:**

- `query`: Search query string

**Returns:** Array of search results or `null` if not available

## Platform Support

### iOS

✅ **Fully Supported**: The MAPS.ME integration is designed for iOS and uses native framework capabilities.

**Requirements:**

- iOS 11.0+
- Xcode 12.0+
- CocoaPods
- Development build (native modules don't work in Expo Go)

### Android

❌ **Not Yet Implemented**: The current integration only supports iOS. Android support would require:

1. Creating a similar native bridge for Android
2. Integrating the MAPS.ME Android SDK
3. Handling platform-specific differences
4. Updating the React Native component to handle both platforms

### Web

❌ **Not Supported**: MAPS.ME is a native framework and cannot run in web browsers. The component falls back to the existing WebView-based Leaflet implementation.

## Project Structure

```
mapsme-react-native/
├── index.ts                  # Main component and utilities
├── MapsMeView.tsx            # React Native view component
├── MapsMeModule.ts           # Native module bridge
├── ios/                      # iOS native implementation
│   └── MapsMeReactNative/    # Native bridge files
│       ├── MapsMeReactNative.podspec
│       ├── MapsMeViewManager.h
│       └── MapsMeViewManager.mm
├── package.json              # Module configuration
└── README.md                 # This file
```

## Dependencies

### JavaScript Dependencies

The module requires:

- React 18.0.0+
- React Native 0.72.0+

These are already included as peer dependencies and should be provided by the parent project.

### Native Dependencies

For iOS, the following dependencies are required:

1. **MAPS.ME Framework**: The core MAPS.ME framework
2. **CoreApi**: MAPS.ME core API module
3. **Additional SDKs**: AppsFlyer, Pushwoosh, Facebook SDKs, etc.

These are configured in the Podfile and will be installed via CocoaPods.

## Troubleshooting

### Common Issues

**Framework initialization fails:**

- Ensure you're using a development build (not Expo Go)
- Check that the MAPS.ME module is properly copied to the iOS project
- Verify that all required dependencies are installed via CocoaPods
- Run `pod install` in the ios directory

**Map not rendering:**

- Check that the view has proper dimensions
- Verify that the framework initialized successfully
- Ensure the component is only used on iOS (Android/web will show fallback)

**Build errors:**

- Run `pod install` in the ios directory
- Clean the Xcode project and rebuild
- Check that all header search paths are correctly configured

### Debugging Tips

1. **Check logs**: Look for initialization messages and errors
2. **Verify plugin**: Ensure the MAPS.ME plugin is properly configured
3. **Inspect iOS project**: Check that MapsMeReactNative is properly copied
4. **Test incrementally**: Start with basic functionality before adding complex features

## Contributing

Contributions to the MAPS.ME integration are welcome! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow the existing code style** for both TypeScript and Objective-C++
3. **Add tests** for new functionality
4. **Update documentation** for any changes
5. **Submit a pull request** with a clear description of your changes

## License

This MAPS.ME integration is part of the trashroute-mobile project and follows the same licensing terms.

## Support

For issues specifically related to the MAPS.ME integration:

1. Check the troubleshooting section above
2. Review the usage examples
3. Examine the native module implementation
4. If the issue persists, open an issue with detailed reproduction steps

For general MAPS.ME framework issues, please refer to the main MAPS.ME project documentation.
