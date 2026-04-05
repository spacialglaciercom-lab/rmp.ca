# Bastille → CBSD Conversion Plan

> **Status:** Planning  
> **Date:** 2026-04-05  
> **Scope:** Convert all 7 Bastille-managed FreeBSD jails to CBSD-managed jails

---

## 1. Why CBSD?

| Concern | Bastille (current) | CBSD |
|---------|-------------------|------|
| **Networking** | VNET via manual bridge setup | Built-in VNET/VALE support with `cbsd jconstruct-tui` or profiles |
| **Snapshots** | Manual ZFS commands | Integrated `cbsd jsnapshot` / `cbsd jclone` |
| **Live migration** | Not supported | `cbsd jmigrate` between CBSD hosts |
| **Clustering** | Single host only | Multi-node cluster with `cbsd node` |
| **Profiles / Automation** | Bastillefile (simple DSL) | Full jconf profiles + `cbsd jcreate` automation |
| **Resource limits** | Manual `rctl` | Integrated RACCT/RCTL via jail profiles |
| **Storage backends** | ZFS datasets | ZFS, HAMMER, directory-based |
| **Web UI** | None | Optional ClonOS web panel |

**Key motivations:** native clustering for HA, integrated snapshots/rollback, resource limits per jail, and richer automation primitives.

---

## 2. Current Architecture (Bastille)

### 2.1 Jail Inventory

| Jail | IP | Port(s) | Service | Runtime |
|------|-----|---------|---------|---------|
| `rmpca-extract` | 10.10.0.2 | 4000 → host:4000 | Overture Maps extraction (WebSocket) | Node.js 20 |
| `rmpca-backend` | 10.10.0.3 | 3000 → host:3000 | tRPC/Express API (BFF) | Node.js 20 + pnpm |
| `rmpca-redis` | 10.10.0.4 | 6379 (internal) | Celery broker + result backend | Redis |
| `rmpca-optimizer` | 10.10.0.5 | 8000 (internal) | FastAPI optimizer | Python 3.12 |
| `rmpca-celery` | 10.10.0.6 | — (internal) | Celery worker (OR-Tools) | Python 3.12 |
| `rmpca-nginx-opt` | 10.10.0.7 | 80 → host:8000 | Nginx reverse proxy | Nginx |
| `rmpca-moonshine` | 10.10.0.8 | 8090 → host:8090 | Speech-to-text ASR sidecar | Python 3.11 + ffmpeg |

### 2.2 Network Topology

- Bridge: `bastille0` on `10.10.0.0/24`
- All jails use VNET (`bastille create -V`)
- Host port forwarding via `pf(4)` RDR rules
- Inter-jail DNS: `/etc/hosts` entries (e.g., `10.10.0.5 optimizer` in nginx jail)

### 2.3 Bastille Artifacts to Convert

| Artifact | Location | CBSD Equivalent |
|----------|----------|-----------------|
| `bootstrap.sh` | `bastille/bootstrap.sh` | `cbsd/bootstrap.sh` (calls `cbsd jcreate`) |
| `deploy.sh` | `bastille/deploy.sh` | `cbsd/deploy.sh` (calls `cbsd jexec`) |
| 7 Bastillefiles | `bastille/{service}/Bastillefile` | CBSD jconf profiles + post-create scripts |
| rc.d init scripts | `bastille/{service}/usr/local/etc/rc.d/*` | Reused as-is (no change) |
| libexec wrappers | `bastille/{service}/usr/local/libexec/*` | Reused as-is (no change) |
| env files | `bastille/{service}/usr/local/etc/rmpca/*` | Reused as-is (no change) |
| CLI tools | `bastille/cli/rmpca-status` etc. | Rewrite `bastille` calls → `cbsd` calls |
| redis.conf | `bastille/redis/usr/local/etc/redis.conf` | Reused as-is (no change) |
| nginx config | `bastille/nginx-optimizer/usr/local/etc/nginx/` | Reused as-is (no change) |

---

## 3. Conversion Plan

### Phase 1: CBSD Installation & Initialization

**Goal:** Install CBSD on the FreeBSD host and initialize the environment.

```sh
# Install CBSD
pkg install cbsd

# Initialize CBSD (first-time setup)
# This creates /usr/jails structure, ZFS datasets, etc.
env workdir="/usr/jails" /usr/local/cbsd/sudoexec/initenv

# Fetch the base jail template
cbsd repo action=get sources=base ver=14.2
```

**Files to create:**
- `cbsd/bootstrap.sh` — master setup script (replaces `bastille/bootstrap.sh`)

### Phase 2: Jail Profile Definitions (jconf files)

**Goal:** Create CBSD jail configuration profiles equivalent to each Bastillefile.

Each jail gets a `.jconf` file defining its properties. CBSD profiles replace both `bastille create` flags and Bastillefile directives.

**Directory structure:**
```
cbsd/
├── bootstrap.sh           # Master create + configure script
├── deploy.sh              # Code deployment script
├── profiles/
│   ├── rmpca-extract.jconf
│   ├── rmpca-backend.jconf
│   ├── rmpca-redis.jconf
│   ├── rmpca-optimizer.jconf
│   ├── rmpca-celery.jconf
│   ├── rmpca-nginx-opt.jconf
│   └── rmpca-moonshine.jconf
├── post-create/
│   ├── extract.sh         # Package install + file copy (replaces Bastillefile)
│   ├── backend.sh
│   ├── redis.sh
│   ├── optimizer.sh
│   ├── celery.sh
│   ├── nginx-optimizer.sh
│   └── moonshine.sh
├── files/                 # Service files (rc.d, libexec, env, configs)
│   ├── extract/
│   │   └── usr/local/...  # Same structure as bastille/extract/usr/
│   ├── backend/
│   │   └── usr/local/...
│   ├── redis/
│   │   └── usr/local/...
│   ├── optimizer/
│   │   └── usr/local/...
│   ├── celery/
│   │   └── usr/local/...
│   ├── nginx-optimizer/
│   │   └── usr/local/...
│   └── moonshine/
│       └── usr/local/...
└── cli/
    ├── rmpca              # Updated CLI dispatcher
    ├── rmpca-status       # Rewritten for cbsd
    ├── rmpca-logs
    └── ...                # Other CLI tools (mostly unchanged)
```

#### 3.2.1 Example jconf: `rmpca-extract.jconf`

```ini
jname="rmpca-extract"
jconf_version="1"
host_hostname="rmpca-extract.rmpca.local"
ip4_addr="DHCP"                   # Or fixed: "10.10.0.2/24"
interface="auto"
ver="14.2"
baserw="0"
mount_devfs="1"
allow_mount="0"
allow_raw_sockets="1"
vnet="1"                          # VNET networking (replaces bastille -V)
vimage="1"
ip4_addr="10.10.0.2/24"
gw4="10.10.0.1"
devfs_ruleset="5"
exec_start="/bin/sh /etc/rc"
exec_stop="/bin/sh /etc/rc.shutdown"
```

#### 3.2.2 Example post-create script: `post-create/extract.sh`

```sh
#!/bin/sh
# Replaces bastille/extract/Bastillefile
JAIL="rmpca-extract"
FILES_DIR="$(cd "$(dirname "$0")/../files/extract" && pwd)"

# Install packages (replaces PKG directive)
cbsd jexec jname=${JAIL} pkg install -y node20 npm-node20 python3 gmake

# Create directories (replaces CMD directive)
cbsd jexec jname=${JAIL} mkdir -p /app/extract /usr/local/etc/rmpca

# Copy service files (replaces CP directive)
cbsd jailscp ${FILES_DIR}/usr/local/libexec/rmpca-extract ${JAIL}:/usr/local/libexec/rmpca-extract
cbsd jailscp ${FILES_DIR}/usr/local/etc/rc.d/extract ${JAIL}:/usr/local/etc/rc.d/extract
cbsd jailscp ${FILES_DIR}/usr/local/etc/rmpca/extract.env ${JAIL}:/usr/local/etc/rmpca/extract.env

# Set permissions
cbsd jexec jname=${JAIL} chmod 755 /usr/local/libexec/rmpca-extract
cbsd jexec jname=${JAIL} chmod 755 /usr/local/etc/rc.d/extract

# Enable service (replaces SYSRC directive)
cbsd jexec jname=${JAIL} sysrc extract_enable=YES
```

### Phase 3: Networking

**Goal:** Replicate the `10.10.0.0/24` VNET bridge topology under CBSD.

CBSD manages VNET natively. Key differences:

| Bastille | CBSD |
|----------|------|
| `bastille create -V name release ip/mask bridge` | `vnet=1` in jconf + `ip4_addr` + `gw4` |
| Manual `bastille0` bridge | CBSD creates bridge automatically or uses existing one |
| pf RDR rules (manual) | pf RDR rules (still manual — same approach) |

**Steps:**
1. Configure CBSD's network profile in `initenv` or `/usr/jails/etc/cbsd.conf`
2. Set `vnet=1` and static IPs in each jconf (same 10.10.0.0/24 range)
3. Keep the same `pf.conf` RDR rules — no change needed
4. Keep `/etc/hosts` injection for nginx jail's optimizer resolution

**CBSD bridge configuration:**
```sh
# In /usr/jails/etc/cbsd.conf or via initenv:
bridge_name="cbsd0"           # Replaces bastille0
bridge_ips="10.10.0.1/24"
```

### Phase 4: Bootstrap Script Conversion

**Goal:** Rewrite `bootstrap.sh` to use CBSD commands.

**Command mapping:**

| Bastille | CBSD |
|----------|------|
| `bastille bootstrap 14.2-RELEASE update` | `cbsd repo action=get sources=base ver=14.2` |
| `bastille create -V name release ip/mask bridge` | `cbsd jcreate jconf=/path/to/name.jconf` |
| `bastille start name` | `cbsd jstart jname=name` |
| `bastille template name /path` | Run `post-create/name.sh` script |
| `bastille list` | `cbsd jls` |
| `bastille cmd name ...` | `cbsd jexec jname=name ...` |

### Phase 5: Deploy Script Conversion

**Goal:** Rewrite `deploy.sh` to use CBSD commands.

**Command mapping:**

| Bastille | CBSD |
|----------|------|
| `bastille cmd jail cmd` | `cbsd jexec jname=jail cmd` |
| `tar ... \| bastille cmd jail sh -c "tar ..."` | `cbsd jailscp` or same tar pipe via `cbsd jexec` |
| `bastille template jail path` | `cbsd jexec` + `cbsd jailscp` |

The deploy script structure remains identical — only the command wrappers change. The `jail_cp_dir()` helper becomes:

```sh
jail_cp_dir() {
    local jail="$1" src="$2" dst="$3"
    cbsd jexec jname="${jail}" mkdir -p "${dst}"
    tar -C "${src}" -cf - . | cbsd jexec jname="${jail}" sh -c "tar -C ${dst} -xf -"
}
```

### Phase 6: CLI Tool Updates

**Goal:** Update `rmpca-status` and other CLI tools.

**Changes required:**

| CLI Tool | Change |
|----------|--------|
| `rmpca-status` | Replace `bastille list` → `cbsd jls`, `bastille cmd` → `cbsd jexec` |
| `rmpca-logs` | Replace `bastille cmd` → `cbsd jexec` |
| `rmpca` (dispatcher) | No change (delegates to sub-commands) |
| `rmpca-optimize` | No change (talks HTTP, not jail manager) |
| `rmpca-extract-osm` | No change |
| `rmpca-extract-overture` | No change |
| `rmpca-clean` | No change |
| `rmpca-validate` | No change |
| `rmpca-pipeline` | No change |

Only `rmpca-status` and `rmpca-logs` reference Bastille directly and need rewriting.

### Phase 7: Migration Execution

**Goal:** Migrate running services from Bastille jails to CBSD jails with minimal downtime.

#### 7.1 Pre-migration Checklist

- [ ] CBSD installed and initialized on the host
- [ ] All jconf profiles written and tested
- [ ] All post-create scripts tested on a scratch jail
- [ ] `pf.conf` rules reviewed (no changes expected)
- [ ] Backup of all jail data (application code, Redis dump if persistent, configs)
- [ ] `deploy.sh` (CBSD version) tested in dry-run mode

#### 7.2 Migration Steps (per jail)

Execute in dependency order: **redis → optimizer → celery → nginx-opt → extract → backend → moonshine**

For each jail:

```
1. Stop the Bastille jail:        bastille stop rmpca-{name}
2. Create the CBSD jail:          cbsd jcreate jconf=cbsd/profiles/rmpca-{name}.jconf
3. Start the CBSD jail:           cbsd jstart jname=rmpca-{name}
4. Run post-create script:        sh cbsd/post-create/{name}.sh
5. Deploy application code:       sh cbsd/deploy.sh [--flags]
6. Verify service health:         rmpca status --health --jail rmpca-{name}
7. Smoke test inter-jail comms:   curl http://10.10.0.x:PORT/health
```

#### 7.3 Rollback Plan

If CBSD jails fail health checks:

```
1. Stop CBSD jail:     cbsd jstop jname=rmpca-{name}
2. Remove CBSD jail:   cbsd jremove jname=rmpca-{name}
3. Start Bastille jail: bastille start rmpca-{name}
4. Verify health:      rmpca status --health
```

Both jail managers can coexist temporarily since they use different management databases.

### Phase 8: Cleanup

- [ ] Remove `bastille/` directory from repository
- [ ] Uninstall Bastille: `pkg remove bastille`
- [ ] Remove Bastille datasets: `bastille destroy` all old jails
- [ ] Update `docs/` references from Bastille → CBSD
- [ ] Update any CI/CD pipelines or deployment scripts

---

## 4. Files Changed Summary

| Action | File(s) | Notes |
|--------|---------|-------|
| **Create** | `cbsd/bootstrap.sh` | New master setup script |
| **Create** | `cbsd/deploy.sh` | New deployment script |
| **Create** | `cbsd/profiles/*.jconf` (x7) | Jail configuration profiles |
| **Create** | `cbsd/post-create/*.sh` (x7) | Post-create provisioning scripts |
| **Copy** | `cbsd/files/*/usr/local/...` | rc.d, libexec, env files (unchanged) |
| **Rewrite** | `cbsd/cli/rmpca-status` | `bastille` → `cbsd` commands |
| **Rewrite** | `cbsd/cli/rmpca-logs` | `bastille` → `cbsd` commands |
| **Copy** | `cbsd/cli/rmpca-*` (others) | Unchanged CLI tools |
| **Delete** | `bastille/` (entire directory) | After migration verified |

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| IP address conflict during parallel operation | Low | High | Migrate one jail at a time; stop Bastille before starting CBSD |
| VNET bridge naming collision (`bastille0` vs `cbsd0`) | Low | Medium | Use different bridge names; merge to single bridge post-migration |
| Package version drift between old/new jails | Low | Low | Pin package versions in post-create scripts |
| Redis data loss during migration | Medium | Medium | Redis is ephemeral (no persistence configured); acceptable |
| Downtime during cutover | High | Medium | ~5 min per jail; schedule during maintenance window |
| CBSD learning curve for operators | Medium | Low | Document common commands; provide cheat sheet |

---

## 6. CBSD Quick Reference (for operators)

| Task | Command |
|------|---------|
| List jails | `cbsd jls` |
| Start jail | `cbsd jstart jname=NAME` |
| Stop jail | `cbsd jstop jname=NAME` |
| Exec in jail | `cbsd jexec jname=NAME command` |
| Login to jail | `cbsd jlogin jname=NAME` |
| Create jail | `cbsd jcreate jconf=/path/to/file.jconf` |
| Remove jail | `cbsd jremove jname=NAME` |
| Snapshot jail | `cbsd jsnapshot mode=create jname=NAME snapname=TAG` |
| Rollback snapshot | `cbsd jsnapshot mode=rollback jname=NAME snapname=TAG` |
| Clone jail | `cbsd jclone old=NAME new=NEWNAME` |
| Copy file into jail | `cbsd jailscp /host/path NAME:/jail/path` |
| Jail console (tui) | `cbsd jconstruct-tui` |

---

## 7. Estimated Effort

| Phase | Tasks |
|-------|-------|
| Phase 1: Install CBSD | Install + init |
| Phase 2: Write jconf profiles | 7 profiles + 7 post-create scripts |
| Phase 3: Networking | Bridge config + verify VNET |
| Phase 4: Bootstrap script | Rewrite bootstrap.sh |
| Phase 5: Deploy script | Rewrite deploy.sh |
| Phase 6: CLI updates | Rewrite rmpca-status, rmpca-logs |
| Phase 7: Migration | 7 jails, one at a time |
| Phase 8: Cleanup | Remove Bastille, update docs |
