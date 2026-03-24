/**
 * E2E Tests for Offline-First Sync (Detox)
 * 
 * These tests simulate a user importing a file and seeing a polyline appear,
 * as well as offline sync behavior.
 * 
 * Note: Detox tests require a running app instance and proper configuration.
 * See detox.config.js for setup.
 * 
 * To run these tests:
 *   detox test --configuration ios.sim.debug
 *   detox test --configuration android.emu.debug
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox';

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Offline-First Sync E2E Tests', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { location: 'always', notifications: 'yes' },
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  afterAll(async () => {
    await device.terminateApp();
  });

  // ============================================================================
  // FILE IMPORT TESTS
  // ============================================================================

  describe('File Import Flow', () => {
    it('should import GPX file and display route on map', async () => {
      // Navigate to import screen
      await element(by.id('import-button')).tap();
      await detoxExpect(element(by.id('import-screen'))).toBeVisible();

      // Select GPX file (simulated via test file)
      await element(by.id('select-file-button')).tap();
      
      // Wait for file picker (platform-specific)
      // On iOS: UIDocumentPickerViewController
      // On Android: Intent.ACTION_OPEN_DOCUMENT
      
      // Select test GPX file
      await element(by.id('file-item-test-route.gpx')).tap();
      
      // Wait for parsing
      await waitFor(element(by.id('import-progress')))
        .toBeVisible()
        .withTimeout(5000);
      
      await waitFor(element(by.id('import-success')))
        .toBeVisible()
        .withTimeout(10000);

      // Verify route appears on map
      await element(by.id('close-import-modal')).tap();
      
      // Wait for map to update
      await waitFor(element(by.id('route-polyline')))
        .toBeVisible()
        .withTimeout(3000);

      // Verify route details
      await element(by.id('route-polyline')).tap();
      await detoxExpect(element(by.id('route-details-modal'))).toBeVisible();
      await detoxExpect(element(by.id('route-name'))).toHaveText('Test Route');
    });

    it('should import GeoJSON file with collection points', async () => {
      await element(by.id('import-button')).tap();
      await element(by.id('select-file-button')).tap();
      
      // Select GeoJSON file
      await element(by.id('file-item-collection-points.geojson')).tap();
      
      await waitFor(element(by.id('import-success')))
        .toBeVisible()
        .withTimeout(10000);

      // Verify points appear on map
      await waitFor(element(by.id('collection-point-marker-0')))
        .toBeVisible()
        .withTimeout(3000);

      // Tap on a point to see details
      await element(by.id('collection-point-marker-0')).tap();
      await detoxExpect(element(by.id('point-detail-modal'))).toBeVisible();
    });

    it('should handle invalid file gracefully', async () => {
      await element(by.id('import-button')).tap();
      await element(by.id('select-file-button')).tap();
      
      // Select invalid file
      await element(by.id('file-item-invalid.txt')).tap();
      
      // Should show error message
      await waitFor(element(by.id('import-error')))
        .toBeVisible()
        .withTimeout(5000);

      await detoxExpect(element(by.id('error-message'))).toHaveText(
        'Invalid file format. Please select a GPX or GeoJSON file.'
      );
    });

    it('should handle large file import', async () => {
      await element(by.id('import-button')).tap();
      await element(by.id('select-file-button')).tap();
      
      // Select large file (10000+ points)
      await element(by.id('file-item-large-route.gpx')).tap();
      
      // Should show progress indicator
      await waitFor(element(by.id('import-progress')))
        .toBeVisible()
        .withTimeout(2000);

      // Progress should update
      await waitFor(element(by.id('progress-text')))
        .toHaveText('Processing: 50%')
        .withTimeout(5000);

      // Should complete successfully
      await waitFor(element(by.id('import-success')))
        .toBeVisible()
        .withTimeout(30000);
    });
  });

  // ============================================================================
  // OFFLINE SYNC TESTS
  // ============================================================================

  describe('Offline Sync Flow', () => {
    it('should show offline indicator when disconnected', async () => {
      // Simulate offline state
      await device.setURLBlacklist(['.*']);
      
      // Wait for offline indicator
      await waitFor(element(by.id('offline-indicator')))
        .toBeVisible()
        .withTimeout(5000);

      await detoxExpect(element(by.id('offline-badge'))).toHaveText('Offline');
    });

    it('should queue changes while offline', async () => {
      // Go offline
      await device.setURLBlacklist(['.*']);
      await waitFor(element(by.id('offline-indicator'))).toBeVisible();

      // Make changes
      await element(by.id('collection-point-marker-0')).tap();
      await element(by.id('mark-completed-button')).tap();
      
      // Should show pending sync indicator
      await detoxExpect(element(by.id('pending-sync-badge'))).toBeVisible();
      await detoxExpect(element(by.id('pending-count'))).toHaveText('1 pending');
    });

    it('should sync queued changes when back online', async () => {
      // Make changes while offline
      await device.setURLBlacklist(['.*']);
      await element(by.id('collection-point-marker-0')).tap();
      await element(by.id('mark-completed-button')).tap();
      
      // Go back online
      await device.setURLBlacklist([]);
      
      // Wait for sync to start
      await waitFor(element(by.id('sync-indicator')))
        .toBeVisible()
        .withTimeout(3000);

      // Wait for sync to complete
      await waitFor(element(by.id('sync-complete')))
        .toBeVisible()
        .withTimeout(10000);

      // Pending count should be 0
      await detoxExpect(element(by.id('pending-sync-badge'))).not.toBeVisible();
    });

    it('should handle sync conflicts', async () => {
      // Create conflict scenario
      // 1. Make change offline
      await device.setURLBlacklist(['.*']);
      await element(by.id('collection-point-marker-0')).tap();
      await element(by.id('edit-point-button')).tap();
      await element(by.id('point-notes-input')).replaceText('Local note');
      await element(by.id('save-point-button')).tap();
      
      // 2. Go online (server has different change)
      await device.setURLBlacklist([]);
      
      // 3. Sync should detect conflict
      await waitFor(element(by.id('conflict-modal')))
        .toBeVisible()
        .withTimeout(10000);

      // 4. User resolves conflict
      await element(by.id('resolve-use-local')).tap();
      
      // 5. Verify resolution
      await waitFor(element(by.id('sync-complete')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  // ============================================================================
  // LOCATION-BASED SYNC TESTS
  // ============================================================================

  describe('Location-Based Sync', () => {
    it('should sync nearby bins when location changes', async () => {
      // Mock location change
      await device.setLocation(45.0, -75.0);
      
      // Wait for location sync to trigger
      await waitFor(element(by.id('location-sync-indicator')))
        .toBeVisible()
        .withTimeout(5000);

      // Verify nearby bins are loaded
      await waitFor(element(by.id('collection-point-marker-0')))
        .toBeVisible()
        .withTimeout(10000);

      // Move to new location
      await device.setLocation(45.5, -75.5);
      
      // Wait for new bins to sync
      await waitFor(element(by.id('location-sync-indicator')))
        .toBeVisible()
        .withTimeout(5000);

      // Verify new bins are loaded
      await detoxExpect(element(by.id('collection-point-marker-0'))).toBeVisible();
    });

    it('should not sync when movement is small', async () => {
      // Set initial location
      await device.setLocation(45.0, -75.0);
      await waitFor(element(by.id('location-sync-indicator'))).toBeVisible();
      
      // Move small distance (< 2km)
      await device.setLocation(45.01, -75.0);
      
      // Should not trigger sync
      await detoxExpect(element(by.id('location-sync-indicator'))).not.toBeVisible();
    });

    it('should show sync radius on map', async () => {
      await element(by.id('map-settings-button')).tap();
      await element(by.id('show-sync-radius-switch')).tap();
      await element(by.id('close-settings-modal')).tap();
      
      // Verify radius circle is visible
      await detoxExpect(element(by.id('sync-radius-circle'))).toBeVisible();
    });
  });

  // ============================================================================
  // COLLECTION NAVIGATION TESTS
  // ============================================================================

  describe('Collection Navigation', () => {
    it('should navigate through collection points offline', async () => {
      // Load route offline
      await element(by.id('routes-tab')).tap();
      await element(by.id('route-item-0')).tap();
      await element(by.id('start-route-button')).tap();
      
      // Go offline
      await device.setURLBlacklist(['.*']);
      
      // Navigate to first point
      await element(by.id('navigate-to-next-button')).tap();
      
      // Verify navigation works offline
      await detoxExpect(element(by.id('navigation-view'))).toBeVisible();
      await detoxExpect(element(by.id('offline-indicator'))).toBeVisible();
      
      // Mark point as completed
      await element(by.id('mark-completed-button')).tap();
      
      // Verify completion is queued
      await detoxExpect(element(by.id('pending-sync-badge'))).toBeVisible();
    });

    it('should resume route after app restart', async () => {
      // Start route
      await element(by.id('routes-tab')).tap();
      await element(by.id('route-item-0')).tap();
      await element(by.id('start-route-button')).tap();
      
      // Complete first point
      await element(by.id('mark-completed-button')).tap();
      
      // Restart app
      await device.terminateApp();
      await device.launchApp();
      
      // Should show resume prompt
      await waitFor(element(by.id('resume-route-modal')))
        .toBeVisible()
        .withTimeout(5000);

      await element(by.id('resume-route-button')).tap();
      
      // Verify route state is restored
      await detoxExpect(element(by.id('progress-text'))).toHaveText('1/10 completed');
    });
  });

  // ============================================================================
  // SYNC STATUS INDICATOR TESTS
  // ============================================================================

  describe('Sync Status Indicator', () => {
    it('should show sync status correctly', async () => {
      // Online, no pending
      await detoxExpect(element(by.id('sync-status-indicator'))).toBeVisible();
      await detoxExpect(element(by.id('offline-badge'))).not.toBeVisible();
      await detoxExpect(element(by.id('pending-sync-badge'))).not.toBeVisible();
    });

    it('should show pending count', async () => {
      // Make offline changes
      await device.setURLBlacklist(['.*']);
      await element(by.id('collection-point-marker-0')).tap();
      await element(by.id('mark-completed-button')).tap();
      
      await detoxExpect(element(by.id('pending-sync-badge'))).toHaveText('1 pending');
      
      // Make another change
      await element(by.id('collection-point-marker-1')).tap();
      await element(by.id('mark-completed-button')).tap();
      
      await detoxExpect(element(by.id('pending-sync-badge'))).toHaveText('2 pending');
    });

    it('should allow manual sync trigger', async () => {
      // Make offline changes
      await device.setURLBlacklist(['.*']);
      await element(by.id('collection-point-marker-0')).tap();
      await element(by.id('mark-completed-button')).tap();
      
      // Go online
      await device.setURLBlacklist([]);
      
      // Tap sync button
      await element(by.id('sync-now-button')).tap();
      
      // Verify sync starts
      await waitFor(element(by.id('sync-progress')))
        .toBeVisible()
        .withTimeout(3000);

      // Verify sync completes
      await waitFor(element(by.id('sync-complete')))
        .toBeVisible()
        .withTimeout(10000);
    });
  });
});