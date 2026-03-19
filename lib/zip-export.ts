/**
 * ZIP Export Utility
 * Exports route data (GPX, statistics, report, configuration) as a ZIP archive
 */

import JSZip from "jszip";
import type {
  RouteStatistics,
  RouteReport,
  RouteConfiguration,
} from "@/types/routing";
import { sanitizeRouteStatistics, formatDateDeviceLocal } from "./export-utils";

export interface ExportData {
  gpxData: string | null;
  statistics: RouteStatistics | null;
  report: RouteReport | null;
  configuration: RouteConfiguration;
  timestamp: Date;
}

/**
 * Create a ZIP archive containing all route data
 * @param data Export data containing GPX, statistics, report, and configuration
 * @param filename Base filename for the ZIP (without extension)
 * @returns Promise<Blob> ZIP file blob
 */
export async function createRouteZip(
  data: ExportData,
  filename: string = "trash_route",
): Promise<Blob> {
  const zip = new JSZip();

  // Add GPX file
  if (data.gpxData) {
    zip.file(`${filename}.gpx`, data.gpxData);
  }

  // Add statistics as JSON (sanitized to fix bad time estimates)
  if (data.statistics) {
    const sanitizedStats = sanitizeRouteStatistics(data.statistics);
    zip.file("statistics.json", JSON.stringify(sanitizedStats, null, 2));
  }

  // Add report as JSON (generatedAt in device local time)
  if (data.report) {
    const reportJson = JSON.stringify(
      {
        ...data.report,
        generatedAt: formatDateDeviceLocal(
          data.report.generatedAt instanceof Date
            ? data.report.generatedAt
            : new Date(data.report.generatedAt),
        ),
      },
      null,
      2,
    );
    zip.file("report.json", reportJson);
  }

  // Add configuration as JSON
  const configJson = JSON.stringify(data.configuration, null, 2);
  zip.file("configuration.json", configJson);

  // Add metadata file (exportedAt in device local time)
  const metadata = {
    exportedAt: formatDateDeviceLocal(data.timestamp),
    appVersion: "1.0.0",
    appName: "RouteMasterPro",
    files: {
      gpx: data.gpxData ? `${filename}.gpx` : null,
      statistics: data.statistics ? "statistics.json" : null,
      report: data.report ? "report.json" : null,
      configuration: "configuration.json",
    },
  };
  zip.file("metadata.json", JSON.stringify(metadata, null, 2));

  // Generate ZIP blob
  const blob = await zip.generateAsync({ type: "blob" });
  return blob;
}

/**
 * Create a ZIP archive and return as base64 (for native save/share)
 */
export async function createRouteZipBase64(
  data: ExportData,
  filename: string = "trash_route",
): Promise<string> {
  const zip = new JSZip();

  if (data.gpxData) zip.file(`${filename}.gpx`, data.gpxData);
  if (data.statistics) {
    zip.file(
      "statistics.json",
      JSON.stringify(sanitizeRouteStatistics(data.statistics), null, 2),
    );
  }
  if (data.report) {
    zip.file(
      "report.json",
      JSON.stringify(
        {
          ...data.report,
          generatedAt: formatDateDeviceLocal(
            data.report.generatedAt instanceof Date
              ? data.report.generatedAt
              : new Date(data.report.generatedAt),
          ),
        },
        null,
        2,
      ),
    );
  }
  zip.file("configuration.json", JSON.stringify(data.configuration, null, 2));
  zip.file(
    "metadata.json",
    JSON.stringify(
      {
        exportedAt: formatDateDeviceLocal(data.timestamp),
        appVersion: "1.0.0",
        appName: "RouteMasterPro",
        files: {
          gpx: data.gpxData ? `${filename}.gpx` : null,
          statistics: data.statistics ? "statistics.json" : null,
          report: data.report ? "report.json" : null,
          configuration: "configuration.json",
        },
      },
      null,
      2,
    ),
  );

  return zip.generateAsync({ type: "base64" });
}

/**
 * Download a blob as a file
 * @param blob File blob to download
 * @param filename Filename for the download
 */
export function downloadBlob(blob: Blob, filename: string): void {
  // Create a temporary URL for the blob
  const url = URL.createObjectURL(blob);

  // Create a temporary anchor element and trigger download
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL
  URL.revokeObjectURL(url);
}

/**
 * Export route data as ZIP and trigger download (web only)
 * @param data Export data containing GPX, statistics, report, and configuration
 * @param filename Base filename for the ZIP (without extension)
 */
export async function exportRouteAsZip(
  data: ExportData,
  filename: string = "trash_route",
): Promise<void> {
  if (!data.gpxData && !data.statistics && !data.report) {
    throw new Error(
      "No route data available to export. Please generate a route first.",
    );
  }
  const blob = await createRouteZip(data, filename);
  const timestamp = new Date().toISOString().split("T")[0];
  const zipFilename = `${filename}_${timestamp}.zip`;
  downloadBlob(blob, zipFilename);
}

/**
 * Ensure a file URI has a file:// prefix so the share sheet can open it (iOS).
 */
function toShareableFileUri(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return path;
  if (trimmed.startsWith("file://")) return trimmed;
  if (trimmed.startsWith("/")) return `file://${trimmed}`;
  return path;
}

/**
 * Export route as ZIP on native (iOS/Android): write to document dir and open share sheet
 * Uses documentDirectory so the share sheet can read the file on iOS.
 */
export async function exportRouteAsZipNative(
  data: ExportData,
  filename: string = "trash_route",
): Promise<void> {
  if (!data.gpxData && !data.statistics && !data.report) {
    throw new Error(
      "No route data available to export. Please generate a route first.",
    );
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const zipFilename = `${filename}_${timestamp}.zip`;
  const base64 = await createRouteZipBase64(data, filename);

  const FileSystem = await import("expo-file-system/legacy");
  const { shareAsync, isAvailableAsync } = await import("expo-sharing");
  const { Platform } = await import("react-native");

  // Use documentDirectory so iOS share sheet can read the file (cache can be inaccessible)
  const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? null;
  if (!dir) {
    throw new Error("No writable directory available for export.");
  }

  const filePath = `${dir}${zipFilename}`;
  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const isAvailable = await isAvailableAsync();
  if (!isAvailable) {
    throw new Error("Sharing is not available on this device.");
  }

  const shareUri = toShareableFileUri(filePath);

  // Small delay before shareAsync can avoid iOS share sheet not opening (intermittent hang)
  if (Platform.OS === "ios") {
    await new Promise((r) => setTimeout(r, 250));
  }

  await shareAsync(shareUri, {
    mimeType: "application/zip",
    dialogTitle: "Export Route as ZIP",
  });
}

/**
 * Validate export data
 * @param data Export data to validate
 * @returns true if data is valid for export, false otherwise
 */
export function isExportDataValid(data: ExportData): boolean {
  // At least one of these must be present
  return !!(data.gpxData || data.statistics || data.report);
}

/**
 * Get export data summary
 * @param data Export data
 * @returns Summary string describing what will be exported
 */
export function getExportSummary(data: ExportData): string {
  const items: string[] = [];

  if (data.gpxData) {
    const pointCount = (data.gpxData.match(/<trkpt/g) || []).length;
    items.push(`GPX file (${pointCount} track points)`);
  }

  if (data.statistics) {
    items.push("Route statistics");
  }

  if (data.report) {
    items.push("Route report");
  }

  items.push("Configuration settings");

  return items.join(", ");
}
