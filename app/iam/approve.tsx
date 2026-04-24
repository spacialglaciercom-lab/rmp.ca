import { ThemedView } from "@/components/themed-view";
import { trpc } from "@/lib/trpc";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaView } from "react-native-safe-area-context";

type PermissionKey =
  | "can_view_routes"
  | "can_edit_routes"
  | "can_manage_fleet"
  | "can_view_fleet"
  | "can_manage_users"
  | "can_view_analytics"
  | "can_manage_roles"
  | "can_manage_billing";

const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  can_view_routes: "Allows viewing planned and active routes.",
  can_edit_routes: "Allows modifying route plans and stops.",
  can_manage_fleet: "Allows creating and managing vehicles.",
  can_view_fleet: "Allows viewing fleet vehicle status.",
  can_manage_users: "Allows managing users in the organization.",
  can_view_analytics: "Allows viewing organization analytics.",
  can_manage_roles: "Allows creating roles and changing permissions.",
  can_manage_billing: "Allows managing billing details and plans.",
};

export default function IAMApprovePage() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const safeToken = typeof token === "string" ? token.trim() : "";
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKey[]>(
    [],
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const requestQuery = trpc.rbac.getApprovalRequestByToken.useQuery(
    { token: safeToken },
    {
      enabled: Boolean(safeToken),
      retry: false,
    },
  );

  useEffect(() => {
    if (requestQuery.data?.requestedPermissions?.length) {
      setSelectedPermissions(requestQuery.data.requestedPermissions);
    }
  }, [requestQuery.data?.requestedPermissions]);

  const approveMutation = trpc.rbac.approveAccess.useMutation({
    onSuccess: (data) => {
      setStatusMessage(
        data.status === "approved"
          ? "Request approved successfully."
          : "Request denied successfully.",
      );
    },
    onError: (error) => {
      setStatusMessage(error.message || "Failed to resolve access request.");
    },
  });

  const canSubmit = useMemo(() => {
    return (
      Boolean(safeToken) &&
      !approveMutation.isPending &&
      requestQuery.data?.status === "pending"
    );
  }, [approveMutation.isPending, requestQuery.data?.status, safeToken]);

  const togglePermission = (permission: PermissionKey) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((item) => item !== permission)
        : [...prev, permission],
    );
  };

  const onApprove = async () => {
    if (!safeToken) return;
    await approveMutation.mutateAsync({
      token: safeToken,
      action: "approve",
      approvedPermissions: selectedPermissions,
    });
    await requestQuery.refetch();
  };

  const onDeny = async () => {
    if (!safeToken) return;
    await approveMutation.mutateAsync({
      token: safeToken,
      action: "deny",
      approvedPermissions: [],
    });
    await requestQuery.refetch();
  };

  return (
    <SafeAreaView className="flex-1" edges={["top", "bottom", "left", "right"]}>
      <ThemedView className="flex-1">
        <ScrollView className="flex-1 p-5">
          <Text className="text-2xl font-bold text-foreground mb-3">
            IAM Approval
          </Text>
          {!safeToken ? (
            <Text className="text-base text-error">
              Missing token in approval link.
            </Text>
          ) : requestQuery.isLoading ? (
            <View className="items-center py-8">
              <ActivityIndicator size="large" />
              <Text className="mt-3 text-foreground">Loading request...</Text>
            </View>
          ) : requestQuery.error ? (
            <Text className="text-base text-error">{requestQuery.error.message}</Text>
          ) : requestQuery.data ? (
            <View className="gap-4">
              <View className="bg-surface rounded-xl p-4">
                <Text className="text-foreground font-semibold">
                  Requester:{" "}
                  {requestQuery.data.requester?.name ??
                    requestQuery.data.requester?.email ??
                    `User #${requestQuery.data.requester?.id ?? "unknown"}`}
                </Text>
                {requestQuery.data.requester?.email && (
                  <Text className="text-muted mt-1">
                    {requestQuery.data.requester.email}
                  </Text>
                )}
                <Text className="text-muted mt-2">
                  Status: {requestQuery.data.status}
                </Text>
                <Text className="text-muted mt-2">
                  Expires: {new Date(requestQuery.data.expiresAt).toLocaleString()}
                </Text>
                <Text className="text-foreground mt-3">{requestQuery.data.reason}</Text>
              </View>

              <Text className="text-lg font-semibold text-foreground">
                Requested permissions
              </Text>
              {requestQuery.data.requestedPermissions.map((permission) => {
                const selected = selectedPermissions.includes(permission);
                return (
                  <TouchableOpacity
                    key={permission}
                    className="bg-surface rounded-xl p-4 mb-2"
                    onPress={() => togglePermission(permission)}
                    disabled={!canSubmit}
                    activeOpacity={0.8}
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="font-semibold text-foreground">
                          {permission}
                        </Text>
                        <Text className="text-muted mt-1">
                          {PERMISSION_DESCRIPTIONS[permission]}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name={
                          selected
                            ? "checkbox-marked"
                            : "checkbox-blank-outline"
                        }
                        size={22}
                        color={selected ? "#22C55E" : "#9CA3AF"}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}

              {statusMessage && (
                <Text className="text-base text-foreground">{statusMessage}</Text>
              )}

              {requestQuery.data.status === "pending" ? (
                <View className="gap-3 mt-3">
                  <TouchableOpacity
                    onPress={onApprove}
                    disabled={!canSubmit}
                    className="py-4 rounded-xl items-center bg-green-600"
                  >
                    <Text className="text-white font-semibold">Approve selected</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onDeny}
                    disabled={!canSubmit}
                    className="py-4 rounded-xl items-center bg-red-600"
                  >
                    <Text className="text-white font-semibold">Deny request</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text className="text-muted">
                  This request has already been resolved.
                </Text>
              )}
            </View>
          ) : null}
        </ScrollView>
      </ThemedView>
    </SafeAreaView>
  );
}
