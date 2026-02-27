/**
 * Test component for MAPS.ME integration
 * This component demonstrates basic usage of the MAPS.ME React Native module
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Button, Platform } from 'react-native';
import { useColors } from '@/hooks/use-colors';
import { initializeMapsMeFramework, setMapPosition, getCurrentPosition, search } from '@/lib/mapsme-react-native';

export const MapsMeTest = () => {
  const colors = useColors();
  const [frameworkStatus, setFrameworkStatus] = useState<string>('Not initialized');
  const [currentPosition, setCurrentPosition] = useState<{lat: number, lon: number} | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    const initFramework = async () => {
      try {
        const success = await initializeMapsMeFramework();
        setFrameworkStatus(success ? 'Initialized successfully' : 'Initialization failed');
        
        if (success) {
          // Get current position after initialization
          const position = await getCurrentPosition();
          if (position) {
            setCurrentPosition({
              lat: position.latitude,
              lon: position.longitude
            });
          }
        }
      } catch (error) {
        setFrameworkStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    initFramework();
  }, []);

  const handleSearch = async () => {
    try {
      const results = await search('restaurant');
      setSearchResults(results || []);
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  const handleMoveToLocation = async () => {
    try {
      await setMapPosition(37.7749, -122.4194); // San Francisco
    } catch (error) {
      console.error('Move error:', error);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.primary }]}>
        MAPS.ME Integration Test
      </Text>

      <View style={[styles.statusBox, { backgroundColor: colors.card }]}>
        <Text style={[styles.statusText, { color: colors.text }]}>
          Framework Status: {frameworkStatus}
        </Text>
        {Platform.OS !== 'ios' && (
          <Text style={[styles.warningText, { color: colors.warning }]}>
            Note: MAPS.ME is only available on iOS
          </Text>
        )}
      </View>

      {currentPosition && (
        <View style={[styles.positionBox, { backgroundColor: colors.card }]}>
          <Text style={[styles.positionText, { color: colors.text }]}>
            Current Position: {currentPosition.lat.toFixed(6)}, {currentPosition.lon.toFixed(6)}
          </Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        <Button
          title="Search for Restaurants"
          onPress={handleSearch}
          color={colors.primary}
        />
        <View style={styles.buttonSpacing} />
        <Button
          title="Move to San Francisco"
          onPress={handleMoveToLocation}
          color={colors.primary}
        />
      </View>

      {searchResults.length > 0 && (
        <View style={[styles.resultsContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.resultsTitle, { color: colors.primary }]}>
            Search Results:
          </Text>
          {searchResults.map((result, index) => (
            <Text key={index} style={[styles.resultItem, { color: colors.text }]}>
              {result.name} ({result.latitude}, {result.longitude})
            </Text>
          ))}
        </View>
      )}

      <View style={[styles.infoBox, { backgroundColor: colors.card }]}>
        <Text style={[styles.infoText, { color: colors.muted }]}>
          This test component verifies that the MAPS.ME React Native module
          is properly integrated with the trashroute-mobile project.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  statusBox: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  statusText: {
    fontSize: 16,
    textAlign: 'center',
  },
  warningText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  positionBox: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  positionText: {
    fontSize: 14,
    textAlign: 'center',
  },
  buttonContainer: {
    marginVertical: 20,
  },
  buttonSpacing: {
    height: 10,
  },
  resultsContainer: {
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  resultItem: {
    fontSize: 14,
    marginBottom: 5,
    paddingLeft: 10,
  },
  infoBox: {
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});