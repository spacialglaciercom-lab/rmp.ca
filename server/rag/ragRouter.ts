import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import {
  ingestDocument,
  removeDocument,
  listDocuments,
  retrieveContext,
} from "./ragService";

export const ragRouter = router({
  ingest: adminProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        content: z.string().min(1),
        category: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await ingestDocument(
        input.filename,
        input.content,
        input.category,
      );
      return { success: true, chunksCreated: result.chunksCreated };
    }),

  remove: adminProcedure
    .input(z.object({ filename: z.string().min(1) }))
    .mutation(({ input }) => {
      const result = removeDocument(input.filename);
      return { success: true, removed: result.removed };
    }),

  list: publicProcedure.query(() => {
    return listDocuments();
  }),

  query: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        topK: z.number().int().min(1).max(10).optional(),
      }),
    )
    .query(async ({ input }) => {
      const results = await retrieveContext(input.query, input.topK);
      return { results };
    }),
});
