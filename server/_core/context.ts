import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  try {
    let user: User | null = null;
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures (e.g. voice.transcribe, voice.chat).
      user = null;
    }
    return {
      req: opts.req,
      res: opts.res,
      user,
    };
  } catch (error) {
    // Ensure we never throw: public procedures must work without login.
    return {
      req: opts.req,
      res: opts.res,
      user: null,
    };
  }
}
