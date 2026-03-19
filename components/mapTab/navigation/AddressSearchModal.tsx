/**
 * Modal to search for an address/place and pick a result for navigation.
 * Uses Google Places UI Kit (Autocomplete + Place Details) when API key is configured;
 * otherwise falls back to Nominatim (OSM) search.
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { searchAddress, type GeocodeResult } from "@/lib/geocode";
import {
  isGooglePlacesConfigured,
  getPlacePredictions,
  getPlaceDetails,
  type GooglePlacePrediction,
} from "@/services/googlePlacesService";
import { TECH_NAV } from "./navigationTechStyle";

export interface AddressSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: { lat: number; lon: number; label: string }) => void;
}

const DEBOUNCE_MS = 320;

export function AddressSearchModal({
  visible,
  onClose,
  onSelect,
}: AddressSearchModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [googlePredictions, setGooglePredictions] = useState<
    GooglePlacePrediction[]
  >([]);
  const [useGooglePlaces, setUseGooglePlaces] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setGooglePredictions([]);
      setError(null);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    }
  }, [visible]);

  useEffect(() => {
    let mounted = true;
    isGooglePlacesConfigured().then((ok) => {
      if (mounted) setUseGooglePlaces(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const fetchGooglePredictions = useCallback(async (q: string) => {
    if (!q.trim()) {
      setGooglePredictions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await getPlacePredictions(q.trim());
      setGooglePredictions(list ?? []);
      if ((list?.length ?? 0) === 0)
        setError("No places found. Try a different search.");
    } catch (e) {
      setGooglePredictions([]);
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!useGooglePlaces || !query.trim()) {
      setGooglePredictions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchGooglePredictions(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [useGooglePlaces, query, fetchGooglePredictions]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    if (useGooglePlaces) {
      await fetchGooglePredictions(q);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await searchAddress(q);
      const safe = (list ?? []).filter(
        (r): r is GeocodeResult =>
          r != null && typeof r.displayName === "string",
      );
      setResults(safe);
      if (safe.length === 0)
        setError("No results found. Try a different address or place name.");
    } catch (e) {
      setResults([]);
      setError(
        e instanceof Error
          ? e.message
          : "Search failed. Check your connection.",
      );
    } finally {
      setLoading(false);
    }
  }, [query, useGooglePlaces, fetchGooglePredictions]);

  const handleSelectNominatim = useCallback(
    (item: GeocodeResult) => {
      if (!item) return;
      hapticImpact();
      const name = item.displayName ?? `${item.lat}, ${item.lon}`;
      const label = name.length > 60 ? name.slice(0, 57) + "…" : name;
      onSelect({ lat: item.lat, lon: item.lon, label });
      onClose();
    },
    [onSelect, onClose],
  );

  const handleSelectGoogle = useCallback(
    async (pred: GooglePlacePrediction) => {
      if (!pred?.placeId) return;
      hapticImpact();
      setLoading(true);
      setError(null);
      try {
        const details = await getPlaceDetails(pred.placeId);
        if (!details) {
          setError("Could not load place details.");
          return;
        }
        const label =
          (details.displayName || details.formattedAddress || "").length > 60
            ? (details.displayName || details.formattedAddress || "").slice(
                0,
                57,
              ) + "…"
            : details.displayName ||
              details.formattedAddress ||
              `${details.location.lat}, ${details.location.lon}`;
        onSelect({
          lat: details.location.lat,
          lon: details.location.lon,
          label: label || `${details.location.lat}, ${details.location.lon}`,
        });
        onClose();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to get place details.",
        );
      } finally {
        setLoading(false);
      }
    },
    [onSelect, onClose],
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <KeyboardAvoidingView
        style={[
          styles.overlay,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[styles.header, { borderBottomColor: TECH_NAV.glassBorder }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            Search address
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={12}
          >
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={colors.muted}
            />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.searchRow,
            { borderBottomColor: TECH_NAV.glassBorder },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.surface,
                borderColor: TECH_NAV.inputBorder,
                borderRadius: TECH_NAV.radiusInput,
              },
            ]}
            placeholder={
              useGooglePlaces ? "Search places or addresses…" : "Where to?"
            }
            placeholderTextColor={colors.muted + "cc"}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setError(null);
              if (!useGooglePlaces) setResults([]);
            }}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={[
              styles.searchBtn,
              {
                backgroundColor: TECH_NAV.blue,
                borderRadius: TECH_NAV.radiusInput,
              },
            ]}
            onPress={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialCommunityIcons name="magnify" size={24} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.message}>
            <MaterialCommunityIcons
              name="information-outline"
              size={20}
              color={colors.muted}
            />
            <Text style={[styles.messageText, { color: colors.muted }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {useGooglePlaces ? (
          <FlatList
            data={googlePredictions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.row,
                  { borderBottomColor: TECH_NAV.glassBorder },
                ]}
                onPress={() => handleSelectGoogle(item)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={22}
                  color={TECH_NAV.blue}
                />
                <Text
                  style={[styles.rowText, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {item.text || item.placeId}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              !loading && query.trim() && !error ? (
                <View style={styles.message}>
                  <Text style={[styles.messageText, { color: colors.muted }]}>
                    Type to search with Google Places
                  </Text>
                </View>
              ) : null
            }
          />
        ) : (
          <FlatList
            data={results.filter((r) => r != null)}
            keyExtractor={(item) =>
              item ? `${item.lat}-${item.lon}` : `fallback-${Math.random()}`
            }
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              if (!item) return null;
              const name = item.displayName ?? `${item.lat}, ${item.lon}`;
              return (
                <TouchableOpacity
                  style={[
                    styles.row,
                    { borderBottomColor: TECH_NAV.glassBorder },
                  ]}
                  onPress={() => handleSelectNominatim(item)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name="map-marker-outline"
                    size={22}
                    color={TECH_NAV.blue}
                  />
                  <Text
                    style={[styles.rowText, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {name}
                  </Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              !loading && query.trim() && !error ? (
                <View style={styles.message}>
                  <Text style={[styles.messageText, { color: colors.muted }]}>
                    Enter an address and tap search
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeBtn: {
    padding: 4,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  searchBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  messageText: {
    fontSize: 14,
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
  },
});
