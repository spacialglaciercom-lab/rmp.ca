# Testing the app without the Expo tunnel

You don’t need the ngrok tunnel to use Expo. Here are ways to run and test the app when the tunnel is slow or broken.

---

## 1. **Same Wi‑Fi (LAN) – best for a real device**

No tunnel. Phone and PC must be on the **same Wi‑Fi**.

1. Run:
   ```bash
   pnpm run mobile
   ```
2. In the terminal you’ll see something like:
   - `Metro waiting on exp://192.168.1.88:8082`
   - A QR code
3. On your phone (Expo Go installed):
   - **Android:** Expo Go → “Scan QR code” and scan the QR.
   - **iOS:** Camera app can open the QR in Expo Go.
   - Or in Expo Go choose “Enter URL manually” and type the `exp://192.168.x.x:8082` URL shown in the terminal.

**If it says “Couldn’t connect”:**

- Confirm phone and PC are on the same Wi‑Fi (not phone on cellular).
- Try turning Windows “Private network” on for your Wi‑Fi (Settings → Network → your Wi‑Fi → profile = Private).
- Temporarily turn off Windows Firewall for Private network to test, then add a rule for Node if needed (see `TUNNEL-FIREWALL-RULES.md` for Node path).

---

## 2. **Web – test in the browser**

Runs the app as a web app. No phone, no tunnel, no emulator.

```bash
pnpm run dev
```

Then open **http://localhost:19007** in Chrome (or another browser).  
Good for UI and flow; some native-only features won’t exist on web.

---

## 3. **Android emulator – no physical device**

Runs the app in an emulator on your PC. No Wi‑Fi or tunnel.

1. Install **Android Studio** and create an AVD (Tools → Device Manager → Create Virtual Device).
2. Start the emulator (start the AVD).
3. In the project:
   ```bash
   pnpm run mobile:android
   ```
   or:
   ```bash
   pnpm run mobile
   ```
   then press **a** to open on Android.  
   Expo/Metro will target the emulator; the emulator talks to Metro over localhost.

---

## 4. **USB (Android) – phone on same PC**

Phone connected by USB, no Wi‑Fi needed.

1. On the phone: enable **Developer options** and **USB debugging**.
2. Connect the phone with USB.
3. In a terminal:
   ```bash
   adb reverse tcp:8081 tcp:8081
   ```
   (Use the port Metro shows, e.g. 8082 → `adb reverse tcp:8082 tcp:8082`.)
4. Run:
   ```bash
   pnpm run mobile
   ```
5. In Expo Go on the phone, enter URL manually: `exp://127.0.0.1:8081` (or the port from step 3).

Traffic goes over USB, so no tunnel and no Wi‑Fi.

---

## 5. **iOS Simulator (Mac only)**

If you’re on a Mac with Xcode:

```bash
pnpm run mobile:ios
```

or `pnpm run mobile` then press **i**. The app opens in the iOS Simulator; no device or tunnel.

---

## Quick reference

| Goal                   | Command / step                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| Phone on same Wi‑Fi    | `pnpm run mobile` → scan QR or enter `exp://…` URL                     |
| Browser only           | `pnpm run dev` → http://localhost:19007                                |
| Android emulator       | Start AVD → `pnpm run mobile:android` or `mobile` + **a**              |
| Android phone via USB  | USB + `adb reverse` → `pnpm run mobile` → enter `exp://127.0.0.1:PORT` |
| iOS Simulator (Mac)    | `pnpm run mobile:ios` or `mobile` + **i**                              |
| Tunnel (when it works) | `pnpm run mobile:tunnel` or manual ngrok                               |

---

## If Metro still won’t start

If `pnpm run mobile` fails with “Failed to start watch mode” or similar:

- **Clear caches and try again:**
  ```bash
  pnpm run cache:clear
  pnpm run mobile
  ```
  Or: `pnpm run mobile:fresh` then `pnpm run mobile`.
- **Windows / OneDrive:**  
  This project's `metro.config.cjs` disables Watchman on Windows so Metro uses the Node watcher (avoids timeouts in synced folders). If it still fails: exclude the project folder from **Windows Defender** real-time scanning, or move the project out of OneDrive to a local folder (e.g. `C:\dev\rmp.ca`).
- **Windows file watcher limit:**  
  If you see “ENOSPC” or watcher errors, increase the limit (e.g. [this guide](https://learn.microsoft.com/en-us/windows/wsl/file-permissions#file-watching-and-wsl)) or run Metro inside **WSL2** and use the WSL IP from your phone on the same network.
- **Node version:**  
  Prefer Node 20 LTS; Node 24 can sometimes trigger Metro/transformer issues.

Using **same Wi‑Fi (1)** or **web (2)** or **emulator (3)** avoids the tunnel completely and is usually enough for day‑to‑day testing.
