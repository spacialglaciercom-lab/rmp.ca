import { readdir, readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";

/**
 * List and read GPX files from the configured GPX training folder.
 * Set GPX_TRAINING_PATH in .env to enable.
 *
 * Multi-tenancy: files are stored under {GPX_TRAINING_PATH}/{orgId}/ per organization.
 * Solo users (no org) fall back to the root GPX_TRAINING_PATH.
 */
export const gpxTrainingRouter = router({
  /** List .gpx filenames in the training folder. Returns [] if path not set or not readable. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rootBase = ENV.gpxTrainingPath.trim();
    if (!rootBase) return { files: [] as string[], configured: false };

    // Scope to org subdirectory when the user belongs to an org
    const base = ctx.org
      ? path.join(rootBase, String(ctx.org.id))
      : rootBase;

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
  getContent: protectedProcedure
    .input(z.object({ filename: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const rootBase = ENV.gpxTrainingPath.trim();
      if (!rootBase) {
        return { content: null, error: "GPX_TRAINING_PATH not configured" };
      }

      // Scope to org subdirectory when the user belongs to an org
      const base = ctx.org
        ? path.join(rootBase, String(ctx.org.id))
        : rootBase;

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
