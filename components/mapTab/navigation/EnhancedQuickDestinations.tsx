/**
 * Enhanced Quick Destinations with favorites, recent places, and better management
 */
import React, { useState } from "react";
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView, 
  Alert,
  Modal,
  TextInput
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { useFavoritesStore } from "@/stores/favoritesStore";
import { TECH_NAV } from "./navigationTechStyle";

export type QuickDestinationType = "home" | "work" | "custom";

export interface QuickDestination {
  id: string;
  label: string;
  coords: { lat: number; lon: number };
  type: QuickDestinationType;
  icon?: string;
  color?: string;
}

interface EnhancedQuickDestinationsProps {
  destinations: QuickDestination[];
  onSelect: (destination: QuickDestination) => void;
  onAdd: (type: QuickDestinationType) => void;
  onEdit?: (destination: QuickDestination) => void;
  onDelete?: (destinationId: string) => void;
  recentDestinations?: QuickDestination[];
  showFavorites?: boolean;
  maxRecent?: number;
}

const DEFAULT_DESTINATIONS = [
  { id: "home", label: "Home", type: "home" as const, icon: "home-outline", color: "#FF6B6B" },
  { id: "work", label: "Work", type: "work" as const, icon: "office-building-outline", color: "#4ECDC4" },
];

export function EnhancedQuickDestinations({
  destinations,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  recentDestinations = [],
  showFavorites = true,
  maxRecent = 3,
}: EnhancedQuickDestinationsProps) {
  const colors = useColors();
  const [selectedTab, setSelectedTab] = useState<"quick" | "favorites" | "recent">("quick");
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDestination, setEditingDestination] = useState<QuickDestination | null>(null);
  const [editLabel, setEditLabel] = useState("");
  
  const { favorites } = useFavoritesStore();

  const handleDestinationPress = (destination: QuickDestination) => {
    hapticImpact();
    onSelect(destination);
  };

  const handleAddPress = (type: QuickDestinationType) => {
    hapticImpact();
    onAdd(type);
  };

  const handleEditPress = (destination: QuickDestination) => {
    hapticImpact();
    setEditingDestination(destination);
    setEditLabel(destination.label);
    setEditModalVisible(true);
  };

  const handleDeletePress = (destination: QuickDestination) => {
    hapticImpact();
    Alert.alert(
      "Delete Destination",
      `Are you sure you want to delete "${destination.label}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: () => onDelete?.(destination.id)
        }
      ]
    );
  };

  const handleSaveEdit = () => {
    if (editingDestination && editLabel.trim()) {
      onEdit?.({
        ...editingDestination,
        label: editLabel.trim()
      });
    }
    setEditModalVisible(false);
    setEditingDestination(null);
    setEditLabel("");
  };

  const renderDestinationCard = (destination: QuickDestination, showEdit: boolean = false) => (
    <TouchableOpacity
      key={destination.id}
      style={[
        styles.destinationCard,
        {
          backgroundColor: colors.surface,
          borderColor: TECH_NAV.inputBorder,
          borderRadius: TECH_NAV.radiusInput,
        },
      ]}
      onPress={() => handleDestinationPress(destination)}
    >
      <View style={styles.cardContent}>
        <View style={styles.cardLeft}>
          <MaterialCommunityIcons
            name={destination.icon as any || "map-marker-outline"}
            size={24}
            color={destination.color || colors.primary}
          />
          <View style={styles.cardText}>
            <Text style={[styles.cardLabel, { color: colors.text }]} numberOfLines={1}>
              {destination.label}
            </Text>
            <Text style={[styles.cardSublabel, { color: colors.muted }]} numberOfLines={1}>
              {destination.coords 
                ? `${destination.coords.lat.toFixed(5)}, ${destination.coords.lon.toFixed(5)}`
                : "No location set"
              }
            </Text>
          </View>
        </View>
        {showEdit && (
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={() => handleEditPress(destination)}
              style={styles.actionButton}
            >
              <MaterialCommunityIcons name="pencil" size={16} color={colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeletePress(destination)}
              style={styles.actionButton}
            >
              <MaterialCommunityIcons name="delete" size={16} color={colors.danger || "#FF6B6B"} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderAddCard = (type: QuickDestinationType, label: string, icon: string) => (
    <TouchableOpacity
      key={`add-${type}`}
      style={[
        styles.addCard,
        {
          backgroundColor: colors.surface,
          borderColor: TECH_NAV.glassBorder,
          borderRadius: TECH_NAV.radiusInput,
          borderStyle: "dashed" as const,
        },
      ]}
      onPress={() => handleAddPress(type)}
    >
      <MaterialCommunityIcons name={icon as any} size={32} color={colors.muted} />
      <Text style={[styles.addLabel, { color: colors.muted }]}>
        Add {label}
      </Text>
    </TouchableOpacity>
  );

  const quickDestinations = destinations.length > 0 ? destinations : DEFAULT_DESTINATIONS;

  return (
    <View style={styles.container}>
      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { borderBottomColor: TECH_NAV.glassBorder }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            selectedTab === "quick" && [styles.activeTab, { borderBottomColor: TECH_NAV.blue }],
          ]}
          onPress={() => {
            hapticImpact();
            setSelectedTab("quick");
          }}
        >
          <MaterialCommunityIcons
            name="lightning-bolt"
            size={18}
            color={selectedTab === "quick" ? TECH_NAV.blueLight : colors.muted}
          />
          <Text
            style={[
              styles.tabText,
              { color: selectedTab === "quick" ? TECH_NAV.blueLight : colors.muted },
            ]}
          >
            Quick
          </Text>
        </TouchableOpacity>

        {showFavorites && (
          <TouchableOpacity
            style={[
              styles.tab,
              selectedTab === "favorites" && [styles.activeTab, { borderBottomColor: TECH_NAV.blue }],
            ]}
            onPress={() => {
              hapticImpact();
              setSelectedTab("favorites");
            }}
          >
            <MaterialCommunityIcons
              name="star"
              size={18}
              color={selectedTab === "favorites" ? TECH_NAV.blueLight : colors.muted}
            />
            <Text
              style={[
                styles.tabText,
                { color: selectedTab === "favorites" ? TECH_NAV.blueLight : colors.muted },
              ]}
            >
              Favorites
            </Text>
          </TouchableOpacity>
        )}

        {recentDestinations.length > 0 && (
          <TouchableOpacity
            style={[
              styles.tab,
              selectedTab === "recent" && [styles.activeTab, { borderBottomColor: TECH_NAV.blue }],
            ]}
            onPress={() => {
              hapticImpact();
              setSelectedTab("recent");
            }}
          >
            <MaterialCommunityIcons
              name="history"
              size={18}
              color={selectedTab === "recent" ? TECH_NAV.blueLight : colors.muted}
            />
            <Text
              style={[
                styles.tabText,
                { color: selectedTab === "recent" ? TECH_NAV.blueLight : colors.muted },
              ]}
            >
              Recent
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {selectedTab === "quick" && (
          <View style={styles.tabContent}>
            {quickDestinations.filter(dest => dest.coords).map(dest => renderDestinationCard(dest, true))}
            {quickDestinations.filter(dest => !dest.coords).map(dest => 
              renderAddCard(dest.type, dest.label, dest.icon || "plus")
            )}
          </View>
        )}

        {selectedTab === "favorites" && (
          <View style={styles.tabContent}>
            {favorites.length > 0 ? (
              favorites.map(fav => renderDestinationCard({
                id: `fav-${fav.id}`,
                label: fav.name,
                coords: fav.coords,
                type: "custom",
                icon: "star-outline",
                color: "#FFD700"
              }))
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="star-outline" size={48} color={colors.muted} />
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  No favorites yet
                </Text>
                <Text style={[styles.emptySubtext, { color: colors.muted }]}>
                  Long-press on the map to save a location
                </Text>
              </View>
            )}
          </View>
        )}

        {selectedTab === "recent" && (
          <View style={styles.tabContent}>
            {recentDestinations.slice(0, maxRecent).map(dest => renderDestinationCard(dest))}
            {recentDestinations.length === 0 && (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="history" size={48} color={colors.muted} />
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  No recent destinations
                </Text>
                <Text style={[styles.emptySubtext, { color: colors.muted }]}>
                  Your recent navigation destinations will appear here
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.surface,
                borderRadius: TECH_NAV.radiusCard,
                borderWidth: 1,
                borderColor: TECH_NAV.glassBorder,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Edit Destination
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: TECH_NAV.inputBorder,
                  backgroundColor: colors.surface,
                  borderRadius: TECH_NAV.radiusInput,
                },
              ]}
              value={editLabel}
              onChangeText={setEditLabel}
              placeholder="Enter destination name"
              placeholderTextColor={colors.muted}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: TECH_NAV.glassBorder }]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={{ color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: TECH_NAV.blue }]}
                onPress={handleSaveEdit}
              >
                <Text style={{ color: "#fff" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
  },
  tabContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
  },
  content: {
    maxHeight: 200,
  },
  tabContent: {
    gap: 8,
  },
  destinationCard: {
    borderWidth: 1,
    padding: 12,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  cardText: {
    marginLeft: 12,
    flex: 1,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  cardSublabel: {
    fontSize: 12,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    padding: 6,
  },
  addCard: {
    borderWidth: 2,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    padding: 24,
    width: "80%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});