/**
 * Quick PostgreSQL (Supabase) connection test.
 * Loads .env.server if present, then DATABASE_URL.
 *
 * Run:
 *   DOTENV_CONFIG_PATH=.env.server npx tsx scripts/test-postgres.ts
 * or ensure DATABASE_URL is in .env / .env.server and run:
 *   npx tsx scripts/test-postgres.ts
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.server first (server secrets), then .env
for (const name of [".env.server", ".env"]) {
  const envPath = path.resolve(process.cwd(), name);
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    content.split("\n").forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        const val = m[2].trim().replace(/^["']|["']$/g, "");
        process.env[m[1].trim()] = val;
      }
    });
  }
}

const url = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.server (see .env.server.example).");
  process.exit(1);
}

// Redact password in logs
const safeUrl = url.replace(/:([^:@]+)@/, ":****@");
console.log("Connecting to", safeUrl, "...");

async function run() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    const r = await sql`SELECT 1 as n`;
    console.log("OK: connected (result:", r[0], ")");
    process.exit(0);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "28P01") {
      console.error("Password authentication failed (28P01).");
      console.error("  → Use the database password from Supabase: Project Settings → Database.");
      console.error("  → It is NOT the anon key or service_role key.");
      console.error("  → If the password contains @ # % & =, URL-encode it (e.g. @ → %40).");
    } else {
      console.error("Connection failed:", e.message ?? err);
    }
    process.exit(1);
  } finally {
    await sql.end();
  }
}
run();
