/**
 * NASA Earthdata CMR API Integration Service
 * 
 * Fetches ASTER Global Digital Elevation Model (GDEM) data from NASA's
 * Common Metadata Repository (CMR) API for use in fuel-aware routing.
 * 
 * @see https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html
 * @see https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-standard-products/aster-gdem
 */

import { z } from "zod";

// ============================================================================
// Types and Schemas
// ============================================================================

/**
 * Bounding box in WGS84 coordinates
 */
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * CMR Granule metadata
 */
export interface CmrGranule {
  id: string;
  title: string;
  producerGranuleId: string;
  dataLinks: string[];
  metadataLinks: string[];
  boundingBox: BoundingBox;
  temporalExtent: {
    startDate: string;
    endDate: string | null;
  };
  size: number;
  format: string;
  checksum: string | null;
  checksumType: string | null;
}

/**
 * Download result with file path and metadata
 */
export interface DownloadResult {
  granuleId: string;
  localPath: string;
  size: number;
  checksum: string | null;
  format: string;
}

/**
 * Processing result after loading into PostGIS
 */
export interface ProcessingResult {
  granuleId: string;
  tilesLoaded: number;
  coverageBbox: BoundingBox;
  minElevation: number;
  maxElevation: number;
  importedAt: Date;
}

/**
 * CMR Search Response Schema
 */
const CmrEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  producer_granule_id: z.string(),
  links: z.array(z.object({
    href: z.string(),
    rel: z.string(),
    type: z.string().optional(),
    hreflang: z.string().optional(),
  })),
  time_start: z.string(),
  time_end: z.string().nullable().optional(),
  boundingBox: z.array(z.number()).length(4).optional(),
  polygons: z.array(z.array(z.number())).optional(),
  granule_size: z.number().optional(),
  format: z.string().optional(),
  checksum: z.object({
    Value: z.string(),
    Algorithm: z.string(),
  }).optional(),
});

const CmrFeedSchema = z.object({
  feed: z.object({
    entry: z.array(CmrEntrySchema).optional(),
    "opensearch:totalResults": z.string().optional(),
  }),
});

// ============================================================================
// Error Classes
// ============================================================================

export class EarthdataAuthError extends Error {
  constructor(message: string, public readonly statusCode: number = 401) {
    super(message);
    this.name = "EarthdataAuthError";
  }
}

export class EarthdataRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number = 60,
    public readonly statusCode: number = 429
  ) {
    super(message);
    this.name = "EarthdataRateLimitError";
  }
}

export class EarthdataNetworkError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "EarthdataNetworkError";
  }
}

export class EarthdataProcessingError extends Error {
  constructor(message: string, public readonly granuleId?: string) {
    super(message);
    this.name = "EarthdataProcessingError";
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface EarthdataConfig {
  /** NASA Earthdata Bearer token */
  bearerToken: string;
  /** CMR API base URL */
  cmrBaseUrl?: string;
  /** Download directory for temporary files */
  downloadDir?: string;
  /** Maximum concurrent downloads */
  maxConcurrentDownloads?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Maximum retries on rate limit */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms) */
  baseRetryDelay?: number;
}

const DEFAULT_CONFIG: Required<Omit<EarthdataConfig, "bearerToken">> = {
  cmrBaseUrl: "https://cmr.earthdata.nasa.gov",
  downloadDir: "/tmp/earthdata",
  maxConcurrentDownloads: 3,
  requestTimeout: 30000,
  maxRetries: 5,
  baseRetryDelay: 1000,
};

// ============================================================================
// Earthdata Service Class
// ============================================================================

export class EarthdataService {
  private readonly config: Required<EarthdataConfig>;
  private readonly abortController: AbortController;

  constructor(config: EarthdataConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<EarthdataConfig>;
    this.abortController = new AbortController();
  }

  /**
   * Search for ASTER GDEM granules intersecting a bounding box
   * 
   * @param bbox Bounding box in WGS84 coordinates
   * @param options Additional search options
   * @returns Array of matching granules
   */
  async searchAsterGdem(
    bbox: BoundingBox,
    options?: {
      maxResults?: number;
      temporalStart?: string;
      temporalEnd?: string;
    }
  ): Promise<CmrGranule[]> {
    const { maxResults = 100, temporalStart, temporalEnd } = options || {};

    // ASTER GDEM Collection Concept ID
    // ASTER GDEM V003: C1711964966-LPDAAC_ECS
    const collectionConceptId = "C1711964966-LPDAAC_ECS";

    // Use smaller page size to avoid memory issues
    const pageSize = Math.min(maxResults, 100);
    const allGranules: CmrGranule[] = [];
    let pageNum = 1;
    let hasMore = true;

    try {
      while (hasMore && allGranules.length < maxResults) {
        // Build CMR search URL
        const params = new URLSearchParams({
          collection_concept_id: collectionConceptId,
          bounding_box: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
          page_size: String(pageSize),
          page_num: String(pageNum),
        });

        if (temporalStart) {
          params.set("temporal_start", temporalStart);
        }
        if (temporalEnd) {
          params.set("temporal_end", temporalEnd);
        }

        const url = `${this.config.cmrBaseUrl}/search/granules.json?${params.toString()}`;

        const response = await this.fetchWithRetry(url, {
          headers: {
            Accept: "application/json",
          },
        });

        const data = await response.json();
        const parsed = CmrFeedSchema.safeParse(data);

        if (!parsed.success) {
          throw new EarthdataProcessingError(
            `Failed to parse CMR response: ${parsed.error.message}`
          );
        }

        const entries = parsed.data.feed.entry || [];
        const granules = entries.map(this.parseGranule).filter((g): g is CmrGranule => g !== null);
        
        allGranules.push(...granules);
        
        // Check if we need to fetch more pages
        hasMore = entries.length === pageSize;
        pageNum++;
        
        // Stop if we've reached maxResults
        if (allGranules.length >= maxResults) {
          break;
        }
      }

      return allGranules.slice(0, maxResults);
    } catch (error) {
      if (error instanceof EarthdataAuthError || error instanceof EarthdataRateLimitError) {
        throw error;
      }
      throw new EarthdataNetworkError(
        `Failed to search CMR: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Download a granule's data file
   * 
   * @param granule The granule to download
   * @param options Download options
   * @returns Download result with local file path
   */
  async downloadGranule(
    granule: CmrGranule,
    options?: {
      preferredFormat?: string;
      onProgress?: (progress: { downloaded: number; total: number }) => void;
    }
  ): Promise<DownloadResult> {
    const { preferredFormat = "GeoTIFF" } = options || {};

    // Find the best download link
    const dataLink = this.selectDataLink(granule.dataLinks, preferredFormat);
    if (!dataLink) {
      throw new EarthdataProcessingError(
        `No suitable download link found for granule ${granule.id}`,
        granule.id
      );
    }

    // Create download directory if needed
    const downloadDir = this.config.downloadDir;
    await this.ensureDir(downloadDir);

    // Extract filename from URL
    const filename = this.extractFilename(dataLink);
    const localPath = `${downloadDir}/${filename}`;

    try {
      const response = await this.fetchWithRetry(dataLink, {
        headers: {
          Authorization: `Bearer ${this.config.bearerToken}`,
        },
      });

      // Handle redirects (NASA often redirects to S3)
      const finalUrl = response.url || dataLink;
      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // Stream to file
      const file = await this.openFile(localPath, "w");
      let downloaded = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new EarthdataNetworkError("Response body is not readable");
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          await this.writeFileChunk(file, value);
          downloaded += value.length;

          if (options?.onProgress && total > 0) {
            options.onProgress({ downloaded, total });
          }
        }
      } finally {
        await this.closeFile(file);
      }

      return {
        granuleId: granule.id,
        localPath,
        size: downloaded,
        checksum: granule.checksum,
        format: granule.format || "GeoTIFF",
      };
    } catch (error) {
      if (error instanceof EarthdataAuthError || error instanceof EarthdataRateLimitError) {
        throw error;
      }
      throw new EarthdataNetworkError(
        `Failed to download granule ${granule.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Download multiple granules concurrently
   * 
   * @param granules Granules to download
   * @param options Download options
   * @returns Array of download results
   */
  async downloadGranules(
    granules: CmrGranule[],
    options?: {
      preferredFormat?: string;
      onProgress?: (granuleId: string, progress: { downloaded: number; total: number }) => void;
      onGranuleComplete?: (granuleId: string, result: DownloadResult) => void;
    }
  ): Promise<DownloadResult[]> {
    const results: DownloadResult[] = [];
    const queue = [...granules];
    const concurrent = this.config.maxConcurrentDownloads;

    // Process in batches
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrent);
      const batchResults = await Promise.all(
        batch.map((granule) =>
          this.downloadGranule(granule, {
            preferredFormat: options?.preferredFormat,
            onProgress: options?.onProgress
              ? (p) => options.onProgress!(granule.id, p)
              : undefined,
          })
        )
      );

      for (const result of batchResults) {
        results.push(result);
        options?.onGranuleComplete?.(result.granuleId, result);
      }
    }

    return results;
  }

  /**
   * Process downloaded granule and load into PostGIS
   * 
   * @param downloadResult Downloaded granule result
   * @param options Processing options
   * @returns Processing result
   */
  async processAndLoadToPostgis(
    downloadResult: DownloadResult,
    options?: {
      databaseUrl?: string;
      tableName?: string;
      tileSize?: string;
      overwrite?: boolean;
    }
  ): Promise<ProcessingResult> {
    const {
      databaseUrl = process.env.DATABASE_URL,
      tableName = "dem_elevation",
      tileSize = "100x100",
      overwrite = false,
    } = options || {};

    if (!databaseUrl) {
      throw new EarthdataProcessingError(
        "DATABASE_URL not set; cannot load into PostGIS",
        downloadResult.granuleId
      );
    }

    // Check if file is compressed (common for NASA data)
    let filePath = downloadResult.localPath;
    if (filePath.endsWith(".zip")) {
      filePath = await this.extractZip(filePath, this.config.downloadDir);
    }

    // Validate GeoTIFF format
    if (!filePath.match(/\.(tif|tiff|vrt)$/i)) {
      // Try to convert using GDAL
      filePath = await this.convertToGeoTiff(filePath, this.config.downloadDir);
    }

    // Build raster2pgsql command
    const sqlFile = `${filePath}.sql`;
    const flags = [
      "-s", "4326",           // SRID WGS84
      "-I",                   // Create spatial index
      "-C",                   // Apply raster constraints
      "-M",                   // VACUUM after load
      "-t", tileSize,         // Tile size
    ];

    if (overwrite) {
      flags.push("-d");       // Drop existing table
    } else {
      flags.push("-a");       // Append to existing
    }

    const raster2pgsqlCmd = `raster2pgsql ${flags.join(" ")} "${filePath}" public.${tableName} > "${sqlFile}"`;

    // Execute raster2pgsql
    await this.execCommand(raster2pgsqlCmd);

    // Load into PostGIS
    const psqlCmd = `psql "${databaseUrl}" -f "${sqlFile}"`;
    await this.execCommand(psqlCmd);

    // Get statistics from database
    const stats = await this.getRasterStats(databaseUrl, tableName);

    // Cleanup temp files
    await this.cleanup([sqlFile]);

    return {
      granuleId: downloadResult.granuleId,
      tilesLoaded: stats.tileCount,
      coverageBbox: stats.bbox,
      minElevation: stats.minValue,
      maxElevation: stats.maxValue,
      importedAt: new Date(),
    };
  }

  /**
   * Full pipeline: search, download, and load into PostGIS
   */
  async fetchAndLoadDem(
    bbox: BoundingBox,
    options?: {
      maxGranules?: number;
      preferredFormat?: string;
      tableName?: string;
      tileSize?: string;
      overwrite?: boolean;
      onProgress?: (phase: string, detail: string) => void;
    }
  ): Promise<ProcessingResult[]> {
    const { maxGranules = 10, onProgress, ...downloadOptions } = options || {};

    // Search
    onProgress?.("search", `Searching for ASTER GDEM granules in ${JSON.stringify(bbox)}`);
    const granules = await this.searchAsterGdem(bbox, { maxResults: maxGranules });

    if (granules.length === 0) {
      onProgress?.("search", "No granules found for the specified bounding box");
      return [];
    }

    onProgress?.("search", `Found ${granules.length} granules`);

    // Download
    const downloadResults: DownloadResult[] = [];
    for (const granule of granules) {
      onProgress?.("download", `Downloading ${granule.title}`);
      const result = await this.downloadGranule(granule, downloadOptions);
      downloadResults.push(result);
      onProgress?.("download", `Downloaded ${result.localPath} (${result.size} bytes)`);
    }

    // Process and load
    const processingResults: ProcessingResult[] = [];
    for (const downloadResult of downloadResults) {
      onProgress?.("process", `Processing ${downloadResult.localPath}`);
      const result = await this.processAndLoadToPostgis(downloadResult, options);
      processingResults.push(result);
      onProgress?.("process", `Loaded ${result.tilesLoaded} tiles into PostGIS`);
    }

    return processingResults;
  }

  /**
   * Abort any ongoing operations
   */
  abort(): void {
    this.abortController.abort();
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async fetchWithRetry(
    url: string,
    init: RequestInit = {},
    retries: number = 0
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.config.bearerToken}`);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: this.abortController.signal,
      });

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        throw new EarthdataAuthError(
          "NASA Earthdata authentication failed. Token may be expired.",
          response.status
        );
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
        
        if (retries < this.config.maxRetries) {
          const delay = this.config.baseRetryDelay * Math.pow(2, retries);
          await this.sleep(Math.max(delay, retryAfter * 1000));
          return this.fetchWithRetry(url, init, retries + 1);
        }

        throw new EarthdataRateLimitError(
          `Rate limited after ${retries} retries. Retry after ${retryAfter}s.`,
          retryAfter
        );
      }

      if (!response.ok) {
        throw new EarthdataNetworkError(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return response;
    } catch (error) {
      if (error instanceof EarthdataAuthError || error instanceof EarthdataRateLimitError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      // Network error - retry with backoff
      if (retries < this.config.maxRetries) {
        const delay = this.config.baseRetryDelay * Math.pow(2, retries);
        await this.sleep(delay);
        return this.fetchWithRetry(url, init, retries + 1);
      }

      throw new EarthdataNetworkError(
        `Network error after ${retries} retries: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private parseGranule(entry: z.infer<typeof CmrEntrySchema>): CmrGranule | null {
    try {
      const dataLinks = entry.links
        .filter((l) => l.rel === "http://esipfed.org/ns/fedsearch/1.1/data#")
        .map((l) => l.href);

      const metadataLinks = entry.links
        .filter((l) => l.rel === "http://esipfed.org/ns/fedsearch/1.1/metadata#")
        .map((l) => l.href);

      // Parse bounding box from polygons if available
      let bbox: BoundingBox | undefined;
      if (entry.polygons && entry.polygons.length > 0) {
        const coords = entry.polygons[0];
        if (coords.length >= 4) {
          bbox = {
            minLon: coords[0],
            minLat: coords[1],
            maxLon: coords[2],
            maxLat: coords[3],
          };
        }
      }

      return {
        id: entry.id,
        title: entry.title,
        producerGranuleId: entry.producer_granule_id,
        dataLinks,
        metadataLinks,
        boundingBox: bbox || { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
        temporalExtent: {
          startDate: entry.time_start,
          endDate: entry.time_end || null,
        },
        size: entry.granule_size || 0,
        format: entry.format || "GeoTIFF",
        checksum: entry.checksum?.Value || null,
        checksumType: entry.checksum?.Algorithm || null,
      };
    } catch {
      return null;
    }
  }

  private selectDataLink(links: string[], preferredFormat: string): string | null {
    // Prefer GeoTIFF format
    const formatPriority = ["GeoTIFF", "HDF5", "NetCDF", ""];

    for (const format of formatPriority) {
      const link = links.find((l) =>
        format ? l.toLowerCase().includes(format.toLowerCase()) : true
      );
      if (link) return link;
    }

    return links[0] || null;
  }

  private extractFilename(url: string): string {
    const parts = url.split("/");
    const filename = parts[parts.length - 1]?.split("?")[0] || `granule_${Date.now()}.tif`;
    return filename;
  }

  private async ensureDir(dir: string): Promise<void> {
    const fs = await import("fs/promises");
    await fs.mkdir(dir, { recursive: true });
  }

  private async openFile(path: string, mode: string): Promise<number> {
    const fs = await import("fs/promises");
    const file = await fs.open(path, mode);
    return file.fd;
  }

  private async writeFileChunk(fd: number, chunk: Uint8Array): Promise<void> {
    const fs = await import("fs/promises");
    await fs.write(fd, chunk);
  }

  private async closeFile(fd: number): Promise<void> {
    const fs = await import("fs/promises");
    await fs.close(fd);
  }

  private async execCommand(cmd: string): Promise<void> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      await execAsync(cmd);
    } catch (error) {
      throw new EarthdataProcessingError(
        `Command failed: ${cmd}\n${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async extractZip(zipPath: string, destDir: string): Promise<string> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Extract using unzip command
    await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`);

    // Find extracted .tif file
    const files = await fs.readdir(destDir);
    const tifFile = files.find((f) => f.endsWith(".tif") || f.endsWith(".tiff"));

    if (!tifFile) {
      throw new EarthdataProcessingError(`No GeoTIFF found in ${zipPath}`);
    }

    return path.join(destDir, tifFile);
  }

  private async convertToGeoTiff(inputPath: string, destDir: string): Promise<string> {
    const path = await import("path");
    const outputPath = path.join(destDir, `${path.basename(inputPath, path.extname(inputPath))}.tif`);

    // Use GDAL to convert
    await this.execCommand(`gdal_translate -of GTiff "${inputPath}" "${outputPath}"`);

    return outputPath;
  }

  private async getRasterStats(
    databaseUrl: string,
    tableName: string
  ): Promise<{
    tileCount: number;
    bbox: BoundingBox;
    minValue: number;
    maxValue: number;
  }> {
    // This would query PostGIS for statistics
    // For now, return placeholder values
    return {
      tileCount: 0,
      bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
      minValue: 0,
      maxValue: 0,
    };
  }

  private async cleanup(files: string[]): Promise<void> {
    const fs = await import("fs/promises");
    await Promise.all(files.map((f) => fs.unlink(f).catch(() => {})));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Instance (Optional)
// ============================================================================

let _instance: EarthdataService | null = null;

/**
 * Get or create the singleton EarthdataService instance
 */
export function getEarthdataService(token?: string): EarthdataService {
  const bearerToken = token || process.env.EARTHDATA_BEARER_TOKEN;

  if (!bearerToken) {
    throw new EarthdataAuthError(
      "EARTHDATA_BEARER_TOKEN not set. Get a token from https://urs.earthdata.nasa.gov/"
    );
  }

  if (!_instance) {
    _instance = new EarthdataService({ bearerToken });
  }

  return _instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetEarthdataService(): void {
  _instance = null;
}