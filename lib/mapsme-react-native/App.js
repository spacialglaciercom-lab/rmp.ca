import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import MapsMeView from './MapsMeView';

const App = () => {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>MAPS.ME React Native</Text>
      <MapsMeView style={styles.map} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5FCFF',
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },
  map: {
    flex: 1,
  },
});

export default App;