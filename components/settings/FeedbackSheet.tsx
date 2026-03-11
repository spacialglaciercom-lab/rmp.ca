/**
 * FeedbackSheet - Right-side dropdown for product feedback.
 * Includes "Report an Issue" and "Suggest an Idea" options.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  Image,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { impactAsync as hapticImpact } from "@/lib/safe-haptics";
import { useColors } from "@/hooks/use-colors";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
  submitIssueReport,
  submitSuggestion,
} from "@/services/feedbackService";
import * as FileSystem from "expo-file-system";

const PANEL_WIDTH_IPAD = 420;

type FeedbackView = "menu" | "report-issue" | "suggest-idea";

const ISSUE_CATEGORIES = [
  { id: "navigation", label: "Navigation & Routing" },
  { id: "map", label: "Map Display" },
  { id: "import-export", label: "Import/Export Data" },
  { id: "account", label: "Account & Settings" },
  { id: "performance", label: "Performance & Crashes" },
  { id: "offline", label: "Offline Features" },
  { id: "other", label: "Other" },
];

interface FeedbackSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function FeedbackSheet({ visible, onClose }: FeedbackSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const deviceType = useDeviceType();

  const [view, setView] = useState<FeedbackView>("menu");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [issueDescription, setIssueDescription] = useState("");
  const [suggestionDescription, setSuggestionDescription] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setView("menu");
    setSelectedCategory(null);
    setIssueDescription("");
    setSuggestionDescription("");
    setUploadedFile(null);
  }, []);

  const handleClose = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleBack = useCallback(() => {
    if (Platform.OS !== "web") hapticImpact();
    if (view === "report-issue" || view === "suggest-idea") {
      setView("menu");
      setSelectedCategory(null);
      setIssueDescription("");
      setSuggestionDescription("");
      setUploadedFile(null);
    }
  }, [view]);

  const handleUpload = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "File upload is not available on web.");
      return;
    }

    try {
      const DocumentPicker = await import("expo-document-picker");
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      setUploadedFile({
        uri: file.uri,
        name: file.name ?? "attachment",
        mimeType: file.mimeType ?? "application/octet-stream",
      });
    } catch (error) {
      console.error("Upload failed:", error);
      Alert.alert("Error", "Failed to pick file. Please try again.");
    }
  }, []);

  const handleSubmitIssue = useCallback(async () => {
    if (!selectedCategory) {
      Alert.alert("Required", "Please select what you were trying to do.");
      return;
    }
    if (!issueDescription.trim()) {
      Alert.alert("Required", "Please describe your issue.");
      return;
    }

    if (Platform.OS !== "web") hapticImpact();
    setSubmitting(true);

    try {
      const categoryLabel =
        ISSUE_CATEGORIES.find((c) => c.id === selectedCategory)?.label ??
        selectedCategory;
      const success = await submitIssueReport({
        category: categoryLabel,
        description: issueDescription.trim(),
      });

      if (success) {
        Alert.alert(
          "Thank You!",
          "Your issue has been reported. We'll look into it as soon as possible.",
          [{ text: "OK", onPress: handleClose }],
        );
      } else {
        Alert.alert("Error", "Failed to submit feedback. Please try again.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [selectedCategory, issueDescription, handleClose]);

  const handleSubmitSuggestion = useCallback(async () => {
    if (!suggestionDescription.trim()) {
      Alert.alert("Required", "Please describe your suggestion.");
      return;
    }

    if (Platform.OS !== "web") hapticImpact();
    setSubmitting(true);

    try {
      let screenshotBase64: string | undefined;
      let attachment:
        | { name: string; base64: string; mimeType: string }
        | undefined;

      if (uploadedFile && Platform.OS !== "web") {
        try {
          const base64 = await FileSystem.readAsStringAsync(uploadedFile.uri, {
            encoding: "base64",
          });
          const isImage = (uploadedFile.mimeType ?? "").startsWith("image/");
          if (isImage) {
            screenshotBase64 = base64;
          } else {
            attachment = {
              name: uploadedFile.name,
              base64,
              mimeType: uploadedFile.mimeType,
            };
          }
        } catch (e) {
          console.warn("Failed to read uploaded file:", e);
        }
      }

      const success = await submitSuggestion({
        description: suggestionDescription.trim(),
        screenshotBase64,
        attachment,
      });

      if (success) {
        Alert.alert(
          "Thank You!",
          "Your suggestion has been submitted. We appreciate your feedback!",
          [{ text: "OK", onPress: handleClose }],
        );
      } else {
        Alert.alert("Error", "Failed to submit feedback. Please try again.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [suggestionDescription, uploadedFile, handleClose]);

  const isIpad = deviceType === "ipad";
  const panelStyle = isIpad
    ? [
        styles.panelIpad,
        {
          width: PANEL_WIDTH_IPAD,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          backgroundColor: colors.surface,
          borderLeftColor: colors.border,
        },
      ]
    : [
        styles.panelPhone,
        {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          maxHeight: "90%",
        },
      ];

  if (!visible) return null;

  const renderMenu = () => (
    <View style={styles.menuContainer}>
      <Text style={[styles.menuTitle, { color: colors.text }]}>
        How can we help?
      </Text>
      <Text style={[styles.menuSubtitle, { color: colors.muted }]}>
        Your feedback helps us improve RouteMaster Pro
      </Text>

      <TouchableOpacity
        style={[
          styles.menuOption,
          {
            backgroundColor: colors.surfaceAlt ?? colors.surface,
            borderColor: colors.border,
          },
        ]}
        onPress={() => {
          if (Platform.OS !== "web") hapticImpact();
          setView("report-issue");
        }}
      >
        <View
          style={[
            styles.menuIconContainer,
            { backgroundColor: "#EF4444" + "20" },
          ]}
        >
          <MaterialCommunityIcons
            name="bug-outline"
            size={24}
            color="#EF4444"
          />
        </View>
        <View style={styles.menuOptionText}>
          <Text style={[styles.menuOptionTitle, { color: colors.text }]}>
            Report an Issue
          </Text>
          <Text style={[styles.menuOptionDesc, { color: colors.muted }]}>
            Something not working as expected?
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={colors.muted}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.menuOption,
          {
            backgroundColor: colors.surfaceAlt ?? colors.surface,
            borderColor: colors.border,
          },
        ]}
        onPress={() => {
          if (Platform.OS !== "web") hapticImpact();
          setView("suggest-idea");
        }}
      >
        <View
          style={[
            styles.menuIconContainer,
            { backgroundColor: colors.primary + "20" },
          ]}
        >
          <MaterialCommunityIcons
            name="lightbulb-outline"
            size={24}
            color={colors.primary}
          />
        </View>
        <View style={styles.menuOptionText}>
          <Text style={[styles.menuOptionTitle, { color: colors.text }]}>
            Suggest an Idea
          </Text>
          <Text style={[styles.menuOptionDesc, { color: colors.muted }]}>
            Have a feature request or improvement?
          </Text>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={24}
          color={colors.muted}
        />
      </TouchableOpacity>
    </View>
  );

  const renderReportIssue = () => (
    <ScrollView
      style={styles.formContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.formTitle, { color: colors.text }]}>
        Report an Issue
      </Text>

      <Text style={[styles.fieldLabel, { color: colors.text }]}>
        When you noticed this issue, what were you trying to do?
      </Text>
      <View style={styles.categoryList}>
        {ISSUE_CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryOption,
              {
                backgroundColor:
                  selectedCategory === cat.id
                    ? colors.primary + "20"
                    : (colors.surfaceAlt ?? colors.surface),
                borderColor:
                  selectedCategory === cat.id ? colors.primary : colors.border,
              },
            ]}
            onPress={() => {
              if (Platform.OS !== "web") hapticImpact();
              setSelectedCategory(cat.id);
            }}
          >
            <MaterialCommunityIcons
              name={
                selectedCategory === cat.id
                  ? "radiobox-marked"
                  : "radiobox-blank"
              }
              size={20}
              color={
                selectedCategory === cat.id ? colors.primary : colors.muted
              }
            />
            <Text style={[styles.categoryLabel, { color: colors.text }]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 20 }]}>
        Describe your issue
      </Text>
      <TextInput
        style={[
          styles.textArea,
          {
            backgroundColor: colors.surfaceAlt ?? colors.surface,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        placeholder="Please provide as much detail as possible..."
        placeholderTextColor={colors.muted}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        value={issueDescription}
        onChangeText={setIssueDescription}
      />

      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: colors.primary }]}
        onPress={handleSubmitIssue}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialCommunityIcons name="send" size={20} color="#fff" />
            <Text style={styles.submitButtonText}>Submit Issue</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );

  const renderSuggestIdea = () => (
    <ScrollView
      style={styles.formContainer}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.formTitle, { color: colors.text }]}>
        Suggest an Idea
      </Text>

      <Text style={[styles.fieldLabel, { color: colors.text }]}>
        Describe your suggestion (required)
      </Text>
      <Text style={[styles.fieldHint, { color: colors.muted }]}>
        Tell us how we can improve our product
      </Text>
      <TextInput
        style={[
          styles.textArea,
          {
            backgroundColor: colors.surfaceAlt ?? colors.surface,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
        placeholder="I would like to see..."
        placeholderTextColor={colors.muted}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        value={suggestionDescription}
        onChangeText={setSuggestionDescription}
      />

      <Text style={[styles.warningText, { color: colors.muted }]}>
        Please don&apos;t include sensitive information
      </Text>

      <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 20 }]}>
        Upload an image or file to help us better understand your idea
      </Text>

      {uploadedFile ? (
        <View style={styles.screenshotPreview}>
          {(uploadedFile.mimeType ?? "").startsWith("image/") ? (
            <Image
              source={{ uri: uploadedFile.uri }}
              style={styles.screenshotImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.filePreview,
                {
                  backgroundColor: colors.surfaceAlt ?? colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="file-document-outline"
                size={40}
                color={colors.muted}
              />
              <Text
                style={[styles.fileName, { color: colors.text }]}
                numberOfLines={2}
              >
                {uploadedFile.name}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.removeScreenshot,
              { backgroundColor: colors.surface },
            ]}
            onPress={() => setUploadedFile(null)}
          >
            <MaterialCommunityIcons
              name="close"
              size={18}
              color={colors.text}
            />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.screenshotButton, { borderColor: colors.border }]}
          onPress={handleUpload}
        >
          <MaterialCommunityIcons
            name="upload-outline"
            size={24}
            color={colors.primary}
          />
          <Text
            style={[styles.screenshotButtonText, { color: colors.primary }]}
          >
            Upload
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.submitButton,
          { backgroundColor: colors.primary, marginTop: 24 },
        ]}
        onPress={handleSubmitSuggestion}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <MaterialCommunityIcons name="send" size={20} color="#fff" />
            <Text style={styles.submitButtonText}>Submit Suggestion</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View
          style={[
            isIpad ? styles.wrapperIpad : styles.wrapperPhone,
            panelStyle,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {view !== "menu" && (
              <TouchableOpacity
                onPress={handleBack}
                style={styles.backButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={24}
                  color={colors.text}
                />
              </TouchableOpacity>
            )}
            <Text style={[styles.headerTitle, { color: colors.text, flex: 1 }]}>
              Send Product Feedback
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.muted}
              />
            </TouchableOpacity>
          </View>

          {view === "menu" && renderMenu()}
          {view === "report-issue" && renderReportIssue()}
          {view === "suggest-idea" && renderSuggestIdea()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  wrapperIpad: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: 1,
  },
  wrapperPhone: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  panelIpad: {
    flex: 1,
  },
  panelPhone: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  closeBtn: {
    padding: 4,
  },
  menuContainer: {
    padding: 20,
  },
  menuTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  menuSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  menuOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  menuOptionText: {
    flex: 1,
  },
  menuOptionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  menuOptionDesc: {
    fontSize: 13,
  },
  formContainer: {
    flex: 1,
    padding: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 13,
    marginBottom: 12,
  },
  categoryList: {
    gap: 8,
  },
  categoryOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  categoryLabel: {
    fontSize: 15,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 120,
  },
  warningText: {
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
  },
  screenshotButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  screenshotButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  screenshotPreview: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
  },
  screenshotImage: {
    width: "100%",
    height: 200,
    borderRadius: 12,
  },
  filePreview: {
    width: "100%",
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fileName: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  removeScreenshot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
    marginBottom: 24,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
