import { readdir, readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";

/**
 * List and read GPX files from the configured GPX training folder (e.g. D:\gpx_training\raw_gpx_files).
 * Set GPX_TRAINING_PATH in .env to enable.
 */
export const gpxTrainingRouter = router({
  /** List .gpx filenames in the training folder. Returns [] if path not set or not readable. */
  list: publicProcedure.query(async () => {
    const base = ENV.gpxTrainingPath.trim();
    if (!base) return { files: [] as string[], configured: false };

    try {
      const entries = await readdir(base, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gpx"))
        .map((e) => e.name)
        .sort();
      return { files, configured: true };
    } catch (err) {
      console.warn("[gpxTraining] list failed:", err);
      return { files: [] as string[], configured: true, error: String(err) };
    }
  }),

  /** Get full GPX XML content of one file by name. Safe: only allows files inside the configured dir. */
  getContent: publicProcedure
    .input(z.object({ filename: z.string().min(1) }))
    .query(async ({ input }) => {
      const base = ENV.gpxTrainingPath.trim();
      if (!base) {
        return { content: null, error: "GPX_TRAINING_PATH not configured" };
      }

      // Avoid path traversal: only allow basename
      const safeName = path.basename(input.filename);
      if (safeName !== input.filename || safeName.includes("..")) {
        return { content: null, error: "Invalid filename" };
      }
      if (!safeName.toLowerCase().endsWith(".gpx")) {
        return { content: null, error: "Not a .gpx file" };
      }

      const fullPath = path.join(base, safeName);
      // Ensure resolved path is still under base
      const resolved = path.resolve(fullPath);
      const baseResolved = path.resolve(base);
      if (!resolved.startsWith(baseResolved)) {
        return { content: null, error: "Invalid path" };
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        return { content, error: null };
      } catch (err) {
        console.warn("[gpxTraining] getContent failed:", err);
        return { content: null, error: String(err) };
      }
    }),
});
