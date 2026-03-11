import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { LayerPicker } from "./LayerPicker";

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default function LayerPickerContent() {
  const router = useRouter();

  const handleClose = () => {
    router.back();
  };

  const handlePreviewOnMap = () => {
    router.replace("/(tabs)/map");
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <LayerPicker
          onClose={handleClose}
          onPreviewOnMap={handlePreviewOnMap}
        />
      </View>
    </ScreenContainer>
  );
}
