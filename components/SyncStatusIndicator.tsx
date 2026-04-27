/**
 * Sync Status Indicator Component
 * 
 * Displays the current sync status with visual indicators
 * for offline/online state and pending changes.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { syncEngine, SyncStatusCallback } from '../lib/database/sync/syncEngine';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useUnresolvedCount, syncConflictStore } from '@/stores/syncConflictStore';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'pending' | 'error';

interface SyncStatusIndicatorProps {
  compact?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
}

export function SyncStatusIndicator({
  compact = false,
  showLabel = true,
  onPress,
}: SyncStatusIndicatorProps) {
  const [status, setStatus] = useState<SyncStatus>('synced');
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [pulseAnim] = useState(new Animated.Value(1));
  const unresolvedCount = useUnresolvedCount();

  // Subscribe to sync status changes
  useEffect(() => {
    const handleSyncStatus: SyncStatusCallback = (syncStatus) => {
      setPendingCount(syncStatus.pendingCount);
      setLastSyncTime(syncStatus.lastSyncTime);

      if (syncStatus.isSyncing) {
        setStatus('syncing');
      } else if (syncStatus.error) {
        setStatus('error');
      } else if (syncStatus.pendingCount > 0) {
        setStatus('pending');
      } else {
        setStatus('synced');
      }
    };

    const unsubscribeSync = syncEngine.subscribe(handleSyncStatus);

    // Subscribe to network status
    const unsubscribeNet = NetInfo.addEventListener((state: NetInfoState) => {
      setIsOnline(state.isConnected ?? false);
    });

    return () => {
      unsubscribeSync();
      unsubscribeNet();
    };
  }, []);

  // Pulse animation for syncing state
  useEffect(() => {
    if (status === 'syncing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  const getStatusConfig = () => {
    switch (status) {
      case 'synced':
        return {
          icon: 'checkmark-circle' as const,
          color: '#22c55e',
          label: 'Synced',
        };
      case 'syncing':
        return {
          icon: 'sync' as const,
          color: '#3b82f6',
          label: 'Syncing...',
        };
      case 'offline':
        return {
          icon: 'cloud-offline' as const,
          color: '#f97316',
          label: 'Offline',
        };
      case 'pending':
        return {
          icon: 'cloud-upload' as const,
          color: '#eab308',
          label: `${pendingCount} pending`,
        };
      case 'error':
        return {
          icon: 'alert-circle' as const,
          color: '#ef4444',
          label: 'Sync error',
        };
      default:
        return {
          icon: 'help-circle' as const,
          color: '#6b7280',
          label: 'Unknown',
        };
    }
  };

  const config = getStatusConfig();

  const formatLastSync = () => {
    if (!lastSyncTime) return 'Never synced';
    const diff = Date.now() - lastSyncTime;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const handlePress = () => {
    if (unresolvedCount > 0) {
      syncConflictStore.getState().setSheetVisible(true);
      return;
    }
    if (onPress) {
      onPress();
    } else if (status === 'pending' || status === 'error') {
      syncEngine.forceSync();
    }
  };

  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.compactContainer, { borderColor: config.color }]}
        onPress={handlePress}
        disabled={status === 'syncing'}
      >
        <Animated.View style={{ opacity: pulseAnim }}>
          <Ionicons name={config.icon} size={16} color={config.color} />
        </Animated.View>
        {unresolvedCount > 0 && (
          <View style={[styles.badge, { backgroundColor: '#f97316', position: 'absolute', top: -4, right: -4 }]}>
            <Text style={styles.badgeText}>{unresolvedCount}</Text>
          </View>
        )}
        {pendingCount > 0 && unresolvedCount === 0 && (
          <View style={[styles.badge, { position: 'absolute', top: -4, right: -4 }]}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.container, { borderColor: config.color }]}
      onPress={handlePress}
      disabled={status === 'syncing'}
    >
      <Animated.View style={[styles.iconContainer, { opacity: pulseAnim }]}>
        <Ionicons name={config.icon} size={24} color={config.color} />
      </Animated.View>

      {showLabel && (
        <View style={styles.textContainer}>
          <Text style={[styles.label, { color: config.color }]}>
            {config.label}
          </Text>
          <Text style={styles.subtext}>
            {isOnline ? formatLastSync() : 'No connection'}
          </Text>
        </View>
      )}

      {pendingCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    gap: 12,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1f2937',
    borderWidth: 1,
  },
  iconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  subtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});