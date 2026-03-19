# GDPR / CCPA Compliance Strategy for Location Data

## Context

rmp.ca processes user-supplied coordinates and route geometry (waypoints, stop lists, optimized paths, GPX exports). If any of this data is persisted server-side — even transiently in logs or optimizer proxy caches — it falls under GDPR (EU/UK) and CCPA (California) obligations. This document scopes the mitigations required.

---

## 1. Data Inventory & Classification

Before applying controls, establish exactly what is stored and where.

| Data type | Where it lives today | Personal? | Retention risk |
|---|---|---|---|
| Raw waypoint coordinates | `optimizerProxy.ts` request body | Yes — location is personal data | High if logged |
| Optimized route geometry | Proxy response / client state | Yes | High if cached server-side |
| GPX export files | Client-generated (no server) | Yes | Low (user-controlled) |
| Plugin config / solver prefs | `vrp-solvers/config.json` | No | None |
| Server access logs (nginx/node) | Host filesystem | Yes (IP + route params) | High |

**Action:** Audit every `console.log`, request logger, and reverse-proxy config to confirm coordinates are never written to durable storage unintentionally.

---

## 2. Data Minimisation (GDPR Art. 5(1)(c))

Only collect what is strictly necessary for the feature to function.

- **Do not log route payloads.** Strip coordinate arrays from any structured logging middleware before they reach a log sink. Use a scrubber/redactor at the proxy layer (`server/optimizerProxy.ts`).
- **No server-side route history.** Unless a "saved routes" feature is explicitly built and consented to, the server should be stateless with respect to route content — receive, forward to OSRM/solver, return result, discard.
- **Aggregate, don't individualise.** If analytics are needed (e.g., heatmaps of popular areas), derive them at ingest and discard the raw coordinates immediately.

---

## 3. Lawful Basis & Consent (GDPR Art. 6 / CCPA §1798.100)

| Processing activity | Recommended lawful basis | Notes |
|---|---|---|
| Route optimisation (core feature) | Legitimate interest / contract performance | No separate consent needed if disclosed in privacy policy |
| Telemetry / crash reporting | Consent | Opt-in toggle in settings |
| Saved routes / history | Consent | Explicit opt-in; never default-on |
| Sharing routes with third parties | Consent | Required before any third-party solver receives coordinates |

**Action:** Add a Privacy Policy page that names every third-party service that receives location data (OSRM instance, any cloud VRP solver endpoint). Link it from the app's settings screen.

---

## 4. Data Retention Policy

Define and enforce maximum retention windows for every storage location.

| Storage | Maximum retention | Enforcement mechanism |
|---|---|---|
| Server access logs | 30 days rolling | Log rotation (`logrotate` / cloud log TTL policy) |
| Optimizer proxy request/response cache | None (stateless target) | No disk cache; memory-only with no persistence |
| Database route records (if built) | User-defined or 90 days default | Scheduled purge job; surfaced in account settings |
| Backups containing route data | 30 days | Backup lifecycle policy |

Document this policy in the Privacy Policy. GDPR requires the period to be "no longer than necessary"; CCPA requires disclosure of the categories and the retention period.

---

## 5. Right to Erasure — "Right to be Forgotten" (GDPR Art. 17 / CCPA §1798.105)

If any user-identifiable route data is stored server-side, a deletion endpoint is required.

### 5.1 Endpoint Design

```
DELETE /api/user/:userId/data
Authorization: Bearer <token>
```

**Behaviour:**
1. Verify the token belongs to `:userId` (prevent IDOR).
2. Delete all records in the `routes`, `history`, and `preferences` tables where `user_id = :userId`.
3. Purge any object-storage blobs (GPX files, snapshots) tagged with the user ID.
4. Enqueue a log-scrubbing task if structured logs contain the user ID (best-effort; document the lag time in the Privacy Policy).
5. Return `204 No Content` on success. Return `202 Accepted` if deletion is asynchronous, with a `Location` header pointing to a status endpoint.
6. Emit an internal audit event (separate, anonymised audit log) confirming deletion occurred.

### 5.2 Verification Workflow

- Require re-authentication (password confirm or email link) before accepting a deletion request — prevents accidental or malicious erasure.
- For CCPA: honour deletion requests submitted by email or web form within **45 days** (15-day extension permitted with notice).
- For GDPR: honour within **30 days** (one-month extension permitted with notice).

### 5.3 What Cannot Be Deleted

Document any lawful exemptions in the response body (e.g., data retained for fraud prevention, legal holds). These must be narrowly scoped.

---

## 6. Right to Access / Portability (GDPR Art. 15 & 20 / CCPA §1798.110)

```
GET /api/user/:userId/data/export
```

Return a machine-readable archive (JSON or ZIP) containing all stored personal data for the user. This is already partially satisfied by the GPX export feature on the client — extend it to cover any server-side stored data.

---

## 7. Data at Rest & In Transit

- **In transit:** All endpoints must be HTTPS-only. OSRM/solver backend calls must also use TLS if they traverse the internet.
- **At rest:** If a database is added, encrypt it at rest (PostgreSQL `pgcrypto`, managed-DB encryption, or filesystem-level encryption). Coordinates are sensitive; treat them like health data.
- **Key management:** Use a secrets manager (Vault, AWS Secrets Manager, environment secrets) — never commit connection strings or API keys to the repository.

---

## 8. Third-Party Data Processors

Any external service that receives coordinates (e.g., a cloud OSRM instance, a third-party VRP API) is a **data processor** under GDPR. Requirements:

- Sign a Data Processing Agreement (DPA) with each processor.
- List all processors in the Privacy Policy.
- Ensure processors do not retain route data beyond the time needed to compute a result.
- Prefer self-hosted OSRM (already the pattern in this codebase) to avoid third-party exposure.

---

## 9. Data Breach Response (GDPR Art. 33–34)

- **72-hour rule:** If a breach involves personal location data, notify the relevant supervisory authority within 72 hours of becoming aware.
- **User notification:** If the breach is "high risk" to individuals, notify affected users without undue delay.
- **Runbook:** Maintain an incident response runbook that includes contact details for the supervisory authority (e.g., ICO for UK, CNIL for France, OPC for Canada).

---

## 10. Implementation Checklist

- [ ] Audit `server/optimizerProxy.ts` — confirm coordinates are not written to any log sink
- [ ] Add a coordinate-scrubbing middleware to the Express/Node layer
- [ ] Write and publish a Privacy Policy naming all processors and retention periods
- [ ] Add a consent banner / settings toggle for any optional telemetry
- [ ] Implement `DELETE /api/user/:userId/data` with IDOR protection and audit logging
- [ ] Implement `GET /api/user/:userId/data/export` for portability
- [ ] Set log rotation to 30-day maximum on all server logs
- [ ] Confirm all external calls to OSRM/solvers use TLS
- [ ] Sign DPAs with any third-party processors
- [ ] Document the breach notification runbook and supervisory authority contacts

---

## References

- GDPR full text: [gdpr-info.eu](https://gdpr-info.eu)
- CCPA text: California Civil Code §1798.100 et seq.
- ICO guidance on location data: ico.org.uk
- CNIL guidelines on geolocation: cnil.fr
