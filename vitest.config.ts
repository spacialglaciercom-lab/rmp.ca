import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      "**/e2e/**",
    ],
    globals: true,
    // Stable V8 coverage merge (avoids missing coverage/.tmp races with default parallel pool)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
    },
  },
  resolve: {
    alias: {
      // React Native uses Flow (import typeof) that Rollup cannot parse. Use a stub in tests.
      "react-native": path.resolve(__dirname, "lib/__tests__/stubs/react-native.ts"),
      "@": path.resolve(__dirname, "."),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
