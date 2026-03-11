import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Route, CollectionPoint } from "@/types";
import { generateRouteId } from "@/lib/utils";

const APP_PREFIX = "com.routemasterpro.trashroute";
const ROUTE_KEY = `${APP_PREFIX}:current_route`;
const HISTORY_KEY = `${APP_PREFIX}:route_history`;

export const storage = {
  // Save current route (ensures unique id, avoids key/state collision)
  async saveRoute(route: Route): Promise<void> {
    try {
      const toSave: Route = {
        ...route,
        id: route.id || generateRouteId(),
        points: route.points.map((p) => ({ ...p })),
      };
      await AsyncStorage.setItem(ROUTE_KEY, JSON.stringify(toSave));
    } catch (error) {
      console.error("Error saving route:", error);
    }
  },

  // Load current route
  async loadRoute(): Promise<Route | null> {
    try {
      const data = await AsyncStorage.getItem(ROUTE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error loading route:", error);
      if (error instanceof SyntaxError) {
        await AsyncStorage.removeItem(ROUTE_KEY).catch(() => {});
      }
      return null;
    }
  },

  // Update a specific collection point
  async updateCollectionPoint(
    routeId: string,
    pointId: string,
    updates: Partial<CollectionPoint>,
  ): Promise<void> {
    try {
      const route = await this.loadRoute();
      if (!route || route.id !== routeId) return;

      const pointIndex = route.points.findIndex((p) => p.id === pointId);
      if (pointIndex === -1) return;

      route.points[pointIndex] = {
        ...route.points[pointIndex],
        ...updates,
      };

      // Update completed count
      route.completedPoints = route.points.filter(
        (p) => p.status === "completed",
      ).length;

      // Update route status
      if (route.completedPoints === route.totalPoints) {
        route.status = "completed";
      } else if (route.completedPoints > 0) {
        route.status = "in_progress";
      }

      await this.saveRoute(route);
    } catch (error) {
      console.error("Error updating collection point:", error);
    }
  },

  // Clear current route
  async clearRoute(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ROUTE_KEY);
    } catch (error) {
      console.error("Error clearing route:", error);
    }
  },

  // Clear route history
  async clearHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      console.error("Error clearing history:", error);
    }
  },

  /** Clear current route and history (for Settings "Clear Cache"). */
  async clearRouteAndHistory(): Promise<void> {
    await this.clearRoute();
    await this.clearHistory();
  },

  // Save route to history (deep clone so mutations don't affect stored entries)
  async saveToHistory(route: Route): Promise<void> {
    try {
      const historyData = await AsyncStorage.getItem(HISTORY_KEY);
      const history: Route[] = historyData ? JSON.parse(historyData) : [];
      const clone: Route = JSON.parse(JSON.stringify(route));
      clone.id = clone.id || generateRouteId();
      history.unshift(clone);
      const limitedHistory = history.slice(0, 30);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(limitedHistory));
    } catch (error) {
      console.error("Error saving to history:", error);
    }
  },

  // Load route history
  async loadHistory(): Promise<Route[]> {
    try {
      const data = await AsyncStorage.getItem(HISTORY_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Error loading history:", error);
      if (error instanceof SyntaxError) {
        await AsyncStorage.removeItem(HISTORY_KEY).catch(() => {});
      }
      return [];
    }
  },
};
