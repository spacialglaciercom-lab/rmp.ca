import React, { useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  maxHeight?: string;
  /** When false, tapping the backdrop does not close the sheet (e.g. so user can tap the map behind). Default true. */
  dismissOnBackdrop?: boolean;
  /** When true, render as an overlay in the current tree (no Modal) so the area above the sheet can receive touches (e.g. map). Use with dismissOnBackdrop={false}. */
  renderInline?: boolean;
  /** When true, show a collapse/expand control in the header so the sheet can be minimized to a strip. */
  collapsible?: boolean;
  /** Controlled collapsed state when collapsible is true. */
  collapsed?: boolean;
  /** Called when user taps the collapse/expand control. */
  onCollapseToggle?: () => void;
  /** Height in pixels when collapsed. Default 56. */
  collapsedHeight?: number;
  children: React.ReactNode;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  overlayInline: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    pointerEvents: "box-none",
    backgroundColor: "transparent",
  },
  /** When renderInline, use this instead of full-screen overlay so the map above stays clickable. */
  overlayInlineBottomOnly: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "45%",
    maxHeight: 420,
    pointerEvents: "box-none",
    backgroundColor: "transparent",
  },
  tapThrough: {
    flex: 1,
    pointerEvents: "none",
    backgroundColor: "transparent",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerBtn: {
    padding: 8,
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
});

function SheetContent({
  title,
  onClose,
  maxHeight,
  insets,
  colors,
  collapsible,
  collapsed,
  onCollapseToggle,
  collapsedHeight,
  children,
}: {
  title: string;
  onClose: () => void;
  maxHeight: string;
  insets: { top: number; bottom: number };
  colors: ReturnType<typeof useColors>;
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapseToggle?: () => void;
  collapsedHeight?: number;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsible && collapsed;
  const heightWhenCollapsed = collapsedHeight ?? 56;

  const handleCollapsePress = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onCollapseToggle?.();
  }, [onCollapseToggle]);

  return (
    <View
      style={[
        styles.sheet,
        {
          height: isCollapsed ? heightWhenCollapsed : maxHeight,
          maxHeight: isCollapsed ? heightWhenCollapsed : maxHeight,
          paddingTop: isCollapsed ? 8 : insets.top + 16,
          paddingBottom: isCollapsed ? 8 : insets.bottom + 24,
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]} pointerEvents="box-none">
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerActions}>
          {collapsible && (
            <TouchableOpacity onPress={handleCollapsePress} style={styles.headerBtn}>
              <MaterialCommunityIcons
                name={collapsed ? "chevron-up" : "chevron-down"}
                size={24}
                color={colors.text}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>
      {!isCollapsed && <View style={styles.content} pointerEvents="box-none">{children}</View>}
    </View>
  );
}

function BottomSheetInner({
  visible,
  onClose,
  title,
  maxHeight = "50%",
  dismissOnBackdrop = true,
  renderInline = false,
  collapsible = false,
  collapsed = false,
  onCollapseToggle,
  collapsedHeight = 56,
  children,
}: BottomSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const sheetNode = (
    <SheetContent
      title={title}
      onClose={handleClose}
      maxHeight={maxHeight}
      insets={insets}
      colors={colors}
      collapsible={collapsible}
      collapsed={collapsed}
      onCollapseToggle={onCollapseToggle}
      collapsedHeight={collapsedHeight}
    >
      {children}
    </SheetContent>
  );

  if (renderInline) {
    return (
      <View style={styles.overlayInlineBottomOnly}>
        <SheetContent
          title={title}
          onClose={handleClose}
          maxHeight="100%"
          insets={insets}
          colors={colors}
          collapsible={collapsible}
          collapsed={collapsed}
          onCollapseToggle={onCollapseToggle}
          collapsedHeight={collapsedHeight}
        >
          {children}
        </SheetContent>
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <Pressable
          style={[styles.backdrop, { pointerEvents: dismissOnBackdrop ? "auto" : "none" }]}
          onPress={dismissOnBackdrop ? handleClose : undefined}
        />
        {sheetNode}
      </View>
    </Modal>
  );
}

export const BottomSheet = React.memo(BottomSheetInner);
