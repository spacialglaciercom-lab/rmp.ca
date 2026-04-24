# GDPR / CCPA — Implementation Plan

This plan translates the compliance strategy into concrete code changes, ordered by risk priority. Each item references the actual files and lines that need to change.

---

## Current State (baseline findings)

| Issue | File | Risk |
|---|---|---|
| Optimizer proxy routes have **no authentication** | `server/optimizerProxy.ts:317` | HIGH |
| No user identity attached to optimizer requests | `server/optimizerProxy.ts:91-128` | HIGH |
| No user data deletion endpoint | — | HIGH (GDPR Art. 17) |
| No user data export endpoint | — | MEDIUM (GDPR Art. 20) |
| MongoDB cost-history retention undefined | `server/db.ts` | MEDIUM |
| PostgreSQL user record retention undefined | `server/db.ts` | MEDIUM |
| External processors (Firebase, ElevenLabs, OpenRouter) not documented | `server/_core/index.ts` | MEDIUM |

---

## Phase 1 — Stop the bleeding (no new data stored without consent)

### 1.1 Add authentication to optimizer proxy routes

**Files:** `server/optimizerProxy.ts`, `server/_core/index.ts`

The routes `/api/optimize`, `/api/vrp/solve`, `/api/geojson/*`, `/api/zones/*`, `/overture/optimize`, `/api/vroom/optimize` currently have no auth middleware. Any unauthenticated client can POST coordinates.

**Change:**
```ts
// server/_core/index.ts — wrap proxy routes with requireAuth
import { requireAuth } from './middleware/requireAuth'

app.use('/api/optimize', requireAuth, optimizerProxy)
app.use('/api/vrp/solve', requireAuth, optimizerProxy)
app.use('/api/vroom/optimize', requireAuth, optimizerProxy)
// etc.
```

```ts
// server/_core/middleware/requireAuth.ts (new file)
import { sdk } from '../sdk'
export async function requireAuth(req, res, next) {
  const user = await sdk.authenticateRequest(req).catch(() => null)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  req.user = user
  next()
}
```

**Note:** If fully anonymous (no-account) use is intentional for the public product, then at minimum log a pseudonymous session ID instead of nothing.

---

### 1.2 Attach user context to optimizer audit log

**File:** `server/optimizerProxy.ts`

The proxy logs `{ method, path, target }` but no user identity. This means there is no way to answer "which coordinates did user X send?" for a GDPR subject access request.

**Change:** Add `userId` and `orgId` to the log line after auth middleware is in place.

```ts
// optimizerProxy.ts — update the log call ~line 91
logger.info({
  method: req.method,
  path: req.path,
  target,
  userId: req.user?.id ?? 'anonymous',
  orgId: req.user?.orgId ?? null,
})
```

This does **not** log the coordinate payload — only identity metadata.

---

### 1.3 Redact coordinates from any debug/error logs

**File:** `server/optimizerProxy.ts`

If `LOG_LEVEL=debug` is ever set, ensure request bodies are not printed. Add a guard:

```ts
// Only log body size, never body content
if (process.env.LOG_LEVEL === 'debug') {
  logger.debug({ bodyBytes: Buffer.byteLength(JSON.stringify(req.body)) })
}
```

Search the whole `server/` directory for `req.body` in log calls and apply the same pattern.

---

## Phase 2 — User rights endpoints

### 2.1 Right to Erasure — `DELETE /api/trpc/user.deleteMyData`

**Files:** New tRPC procedure in the `auth` or new `privacy` router.

This procedure must:
1. Re-verify the caller's identity (tRPC context already provides `ctx.user`).
2. Delete all PostgreSQL rows where `users.id = ctx.user.id`.
3. Delete all MongoDB documents where `userId = ctx.user.id` (cost history, etc.).
4. Invalidate the user's session cookie.
5. Return a confirmation with a timestamp.

```ts
// server/routers/privacy.ts (new file)
export const privacyRouter = router({
  deleteMyData: protectedProcedure
    .mutation(async ({ ctx }) => {
      const { db, user } = ctx
      // 1. Delete route history, cost records, etc. from MongoDB
      await mongoDb.collection('costHistory').deleteMany({ userId: user.id })
      // 2. Delete user record from PostgreSQL (cascades to userRoles etc.)
      await db.delete(users).where(eq(users.id, user.id))
      // 3. Clear session
      ctx.res.clearCookie(process.env.COOKIE_NAME)
      return { deletedAt: new Date().toISOString() }
    }),
})
```

Register in `server/_core/index.ts` under the existing `appRouter`.

---

### 2.2 Right to Access / Portability — `GET /api/trpc/user.exportMyData`

Returns a JSON object with all stored personal data for the authenticated user.

```ts
exportMyData: protectedProcedure
  .query(async ({ ctx }) => {
    const { db, user } = ctx
    const [profile] = await db.select().from(users).where(eq(users.id, user.id))
    const history = await mongoDb.collection('costHistory')
      .find({ userId: user.id }).toArray()
    return {
      exportedAt: new Date().toISOString(),
      profile: { name: profile.name, email: profile.email, orgId: profile.orgId },
      costHistory: history,
    }
  }),
```

---

## Phase 3 — Retention enforcement

### 3.1 PostgreSQL — inactive user purge job

Add a scheduled job (cron or Node `node-cron`) that deletes user records with no activity in 2 years:

```ts
// server/jobs/purgeInactiveUsers.ts
import { db } from '../db'
import { users } from '../schema'
import { lt } from 'drizzle-orm'

export async function purgeInactiveUsers() {
  const cutoff = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
  const deleted = await db.delete(users)
    .where(lt(users.lastSignedIn, cutoff))
    .returning({ id: users.id })
  logger.info({ purgedUsers: deleted.length, cutoff })
}
```

Schedule it to run weekly. Wire it into server startup or a separate worker process.

---

### 3.2 MongoDB — TTL index on cost history

Add a TTL index so documents auto-expire after 90 days (or whatever the policy says):

```ts
// Run once in a migration script
await mongoDb.collection('costHistory').createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
)
```

---

### 3.3 Server log rotation

Ensure stdout/stderr logs are rotated or have a TTL set at the infrastructure level. If running on a VPS, add a `logrotate` config. If running on a cloud platform, set log retention to 30 days in the platform console. This is an infrastructure step, not a code change.

---

## Phase 4 — Privacy Policy & consent surface

### 4.1 Privacy Policy page

Create `pages/privacy.tsx` (or equivalent) with:
- Data categories collected (email, name, location data during route planning)
- Lawful basis for each
- List of data processors: PostgreSQL host, MongoDB host, Firebase (auth), ElevenLabs (voice), OpenRouter (AI), OSRM instance
- Retention periods (as defined in Phase 3)
- How to exercise rights (link to account settings for deletion/export)
- Contact email for GDPR requests

### 4.2 Account Settings UI

In the existing settings UI, add a "Privacy & Data" section with:
- "Download my data" button → calls `user.exportMyData`
- "Delete my account" button → calls `user.deleteMyData` with a confirmation dialog

---

## Phase 5 — Third-party processor audit

For each external service that receives personal data, confirm a DPA is in place and add it to the Privacy Policy:

| Processor | Data sent | DPA available? | Action |
|---|---|---|---|
| Firebase Auth | User email, uid | Yes (Google Cloud DPA) | Link in privacy policy |
| ElevenLabs | Voice audio (may contain PII) | Yes (ElevenLabs ToS/DPA) | Confirm DPA signed |
| OpenRouter / AI provider | Chat messages (may contain location) | Varies by provider | Confirm DPA or switch to EU-hosted model |
| OSRM instance | Coordinates | Self-hosted = no third party | Document in privacy policy |
| Overture / map tile provider | Tile requests (IP address) | Depends on host | Confirm DPA |

---

## Delivery Order

| Phase | Effort | Priority |
|---|---|---|
| 1.1 — Auth on proxy routes | ~2h | P0 |
| 1.2 — User context in audit log | ~1h | P0 |
| 1.3 — Redact coords from debug logs | ~1h | P0 |
| 2.1 — Delete my data endpoint | ~4h | P1 |
| 2.2 — Export my data endpoint | ~2h | P1 |
| 3.1 — Inactive user purge job | ~2h | P2 |
| 3.2 — MongoDB TTL index | ~30m | P2 |
| 3.3 — Log rotation (infra) | ~30m | P2 |
| 4.1 — Privacy Policy page | ~3h | P1 |
| 4.2 — Account Settings UI | ~3h | P2 |
| 5 — Third-party processor audit | ~2h | P2 |
