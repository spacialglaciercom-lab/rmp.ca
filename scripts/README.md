# Starting Scripts

Scripts to start the trashroute-mobile app and backends.

## Quick start

| Script                                    | Description                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `start.bat` / `start.ps1`                 | Expo + tRPC server                                                                     |
| `start-backend.bat` / `start-backend.ps1` | MC-CARP API (trash-route, port 8000)                                                   |
| `start-routemaster.bat`                   | RouteMaster API (port 8003)                                                            |
| `start-all.bat` / `start-all.ps1`         | App + MC-CARP backend in separate windows                                              |
| `kill-ports.bat` / `kill-ports.ps1`       | Free ports 3000 and 19007 (run before start, or start-all does it)                     |
| `reserve-ports.ps1`                       | Optional: reserve 3000 & 19007 for this app only (run as Admin, once)                  |
| `start-at-login.ps1`                      | Same as start-all but for running at Windows login (Expo + MC-CARP, minimized windows) |
| `install-startup.ps1`                     | Add trashroute-mobile to Windows Startup (run once)                                    |
| `uninstall-startup.ps1`                   | Remove from Windows Startup                                                            |

## Usage

**App only:**

```bash
scripts\start.bat
# or
.\scripts\start.ps1
```

**App + MC-CARP backend:**

```bash
scripts\start-all.bat
# or
.\scripts\start-all.ps1
```

**Backend only:**

```bash
scripts\start-backend.bat
# or
.\scripts\start-backend.ps1
```

**Start automatically at Windows login:**

1. Run once (as yourself): `.\scripts\install-startup.ps1`  
   (Right‑click `install-startup.ps1` → Run with PowerShell, or in PowerShell: `cd C:\trashroute-mobile\scripts; .\install-startup.ps1`)
2. After that, each time you log in, the app and MC-CARP backend will start in minimized windows.
3. To stop auto-start: run `.\scripts\uninstall-startup.ps1` or delete the shortcut in **Startup** (Win+R → `shell:Startup`).

## Reserved ports

Ports **3000** (tRPC API) and **19007** (Expo Metro) are used only by this project. `start-all` runs `kill-ports` first so anything else on those ports is stopped before the app starts. To free the ports manually: `scripts\kill-ports.bat` or `.\scripts\kill-ports.ps1`. To reserve them so Windows doesn’t assign them to other apps (optional, run PowerShell as Administrator once): `.\scripts\reserve-ports.ps1`.

## Paths

- **trash-route** (MC-CARP): Script looks for `trash-route` in: (1) `TRASH_ROUTE_PATH` env var, (2) sibling `..\trash-route` of project, (3) `..\..\trash-route`. If not found, Expo + tRPC still start; only MC-CARP is skipped. To point to your backend: set `TRASH_ROUTE_PATH=C:\path\to\trash-route` (folder that contains `src\api_main.py`).
- **RouteMaster**: tries `backend/trash-route-api` — edit `start-routemaster.bat` if yours is elsewhere

## pnpm not found when run at login

The scripts add `%APPDATA%\npm` and `Program Files\nodejs` to PATH so `pnpm` is found when started from Startup or a fresh cmd. If you use nvm/fnm or a custom Node install, set PATH in a login script or set `TRASH_ROUTE_PATH`-style env for Node, or run `start-dev.ps1` (it prepends common Node paths).

## EAS Build (iOS)

The project uses dynamic config (`app.config.ts`). To avoid the "Cannot automatically write to dynamic config" error when linking, run the build in **non-interactive** mode. From the project root:

```bash
pnpm run eas:ios
# or
eas build --platform ios --non-interactive
```

`extra.eas.projectId` is already set in `app.config.ts` and `app.json`; the non-interactive flag skips the prompt that tries to write it again.
