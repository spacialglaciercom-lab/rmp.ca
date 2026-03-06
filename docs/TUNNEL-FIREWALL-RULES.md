# Outbound firewall rules for Expo/ngrok tunnel

If `pnpm run mobile:tunnel` fails with "ngrok tunnel took too long to connect", your firewall or network filter may be blocking ngrok. Add outbound allow rules for the domains below.

## Domains to allow (outbound HTTPS)

| Domain / pattern | Purpose |
|-----------------|--------|
| `*.ngrok.com` | ngrok API and dashboard |
| `*.ngrok-agent.com` | ngrok tunnel agent |
| `*.equinox.io` | ngrok backend (Equinox) |
| `cloud.google.com` | Optional; some Expo/Google services |

**Port:** 443 (HTTPS)  
**Direction:** Outbound (your PC → internet)

---

## Windows Defender Firewall

### Option A: Allow an app (Node/npx)

1. Open **Windows Security** → **Firewall & network protection** → **Advanced settings** (or run `wf.msc`).
2. In the left pane, click **Outbound Rules**.
3. Click **New Rule…** in the right pane.
4. Select **Program** → Next.
5. Select **This program path** and enter:
   - `C:\Program Files\nodejs\node.exe`
   - (If you use nvm/fnm, run `node -e "console.log(process.execPath)"` to get your path.)
6. Next → **Allow the connection** → Next.
7. Leave all profiles (Domain, Private, Public) checked → Next.
8. Name: e.g. **Node – ngrok/Expo tunnel** → Finish.

Repeat for `npx.cmd` if you run tunnel via `npx` and Node isn’t enough:

- Path: `C:\Program Files\nodejs\npx.cmd` (or your Node install folder).

### Option B: Allow by port (less specific)

1. **Outbound Rules** → **New Rule…**
2. **Port** → Next.
3. **TCP**, **Specific remote ports:** `443` → Next.
4. **Allow the connection** → Next.
5. All profiles → Next.
6. Name: e.g. **Outbound HTTPS (ngrok)** → Finish.

This allows all outbound HTTPS; use Option A if you want to limit the rule to Node/npx.

### Option C: Disable firewall temporarily (testing only)

1. **Windows Security** → **Firewall & network protection**.
2. Select your active profile (e.g. **Private network**).
3. Turn **Microsoft Defender Firewall** **Off** (only to test; turn back **On** after).

---

## NordVPN (split tunneling)

If NordVPN is on, tunnel traffic can fail or time out. **Exclude Node from the VPN** so it talks to ngrok over your normal connection:

1. Open **NordVPN**.
2. Click the **gear icon** (Settings) in the bottom-left.
3. Open **Split Tunneling** and turn it **On**.
4. In the dropdown, choose **“Disable VPN for selected apps”** (so listed apps bypass the VPN).
5. Click **“Add apps”** → **“Browse apps”** (or “Choose from list”).
6. Add:
   - **Node.js** → pick `C:\Program Files\nodejs\node.exe` if shown, or browse to that path.
   - Optionally add **npx**: `C:\Program Files\nodejs\npx.cmd` (so the process that runs `expo start --tunnel` is excluded).
7. Click **Add selected** (or **Save**).
8. Restart NordVPN if the option doesn’t apply immediately.

Then run `pnpm run mobile:tunnel` again; Node will use your normal connection for ngrok.

*Note: Split tunneling is available on NordVPN for Windows and Android; not on macOS/iOS.*

---

## Corporate proxy / SSL inspection (e.g. Netskope, Zscaler)

If your company uses a secure web gateway that inspects HTTPS:

1. Ask IT/network team to **allow (do not decrypt)** outbound HTTPS to:
   - `*.ngrok.com`
   - `*.ngrok-agent.com`
   - `*.equinox.io`
   - `cloud.google.com`
2. Wording they often use: *“SSL do not decrypt for *.ngrok.com, *.ngrok-agent.com, *.equinox.io”*.

After they add the exception, run `ngrok diagnose` (if you have ngrok CLI) or `pnpm run mobile:tunnel` again.

---

## If tunnel still fails: manual ngrok workaround

When `pnpm run mobile:tunnel` keeps failing with "ngrok took too long to connect", use **two terminals** and run ngrok yourself (no timeout from Expo):

**Terminal 1 – start Metro (Expo dev server)**  
```bash
pnpm run mobile
```
Leave this running. Metro will listen on port **8081** by default.

**Terminal 2 – start ngrok to that port**  
```bash
pnpm run mobile:tunnel:manual
```
Or: `node scripts/run-ngrok-manual.js`  
Or, if you have ngrok installed globally: `ngrok http 8081`  
(Set `NGROK_AUTHTOKEN` in `.env` so ngrok can authenticate.)

The script (or ngrok) will print a public URL like `https://xxxx.ngrok-free.app`.

**On your phone (Expo Go)**  
- Open Expo Go → **Enter URL manually** (or “Connect”), and paste the **https** URL from Terminal 2.  
- The app will load from your machine via the tunnel.

This avoids Expo’s built-in tunnel timeout; ngrok has no short limit.

---

## Verify

1. Ensure **NGROK_AUTHTOKEN** is set in `.env` (see `.env.example`).
2. Run: `pnpm run mobile:tunnel` (script now retries **10 times** with **12 s** delay by default).
3. If it still times out, use the **manual ngrok workaround** above, or in `.env` set `TUNNEL_MAX_RETRIES=15` and `TUNNEL_RETRY_DELAY_MS=15000`.
