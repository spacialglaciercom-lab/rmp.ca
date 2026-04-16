/**
 * Pre-loader for the Node.js API server.
 *
 * Used via `tsx --require ./scripts/load-server-env.js` so that dotenv runs
 * synchronously BEFORE any module reads process.env at import time.
 *
 * Background: TypeScript `import` statements are hoisted by tsx/esbuild.
 * This means all imported modules (including server/_core/env.ts) run before
 * any non-import code in index.ts — so dotenvConfig() called inside index.ts
 * fires too late. Loading dotenv as a --require pre-loader guarantees it runs
 * first, before the module graph is evaluated.
 */
const { config } = require("dotenv");

// .env.server first (server secrets — never override env vars already set)
config({ path: ".env.server" });
// .env second (shared/public vars)
config({ path: ".env" });
