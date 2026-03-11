# Vercel and local backend setup

The app no longer defaults to Railway. Use this to run with a **local backend**, a **Google Cloud Run** backend, or to fix the **deployed Vercel site** after removing Railway.

**To have Vercel talk to Google Cloud Run**, see **[GOOGLE-CLOUD-RUN.md](./GOOGLE-CLOUD-RUN.md)** for full deploy steps.

## Deployed Vercel site (rmp-ca.vercel.app)

- **Default:** The web app uses **same-origin** for API and extract. It will call `https://rmp-ca.vercel.app/api/*` and `wss://rmp-ca.vercel.app/ws/extract`, so you will **not** see CORS or 502 from Railway.
- **Limitation:** The current Vercel deployment is static only (no Node server). So `/api/*` and `/ws/extract` will 404 until you either:
  1. **Point to an external backend:** In [Vercel → Project → Settings → Environment Variables](https://vercel.com/docs/projects/environment-variables), add:
     - `EXPO_PUBLIC_API_BASE_URL` = `https://your-backend.example.com`  
       Then redeploy. The frontend will call your backend instead of same-origin.  
       **Example:** Use a **Google Cloud Run** backend — see [GOOGLE-CLOUD-RUN.md](./GOOGLE-CLOUD-RUN.md).
  2. **Add API routes:** Deploy the Node server (e.g. as Vercel serverless routes) and optionally set `OPTIMIZER_BACKEND_URL` / `EXTRACT_WS_UPSTREAM` so the server proxies to your optimizer/extract services.

## Local development with local backend

1. **Copy env:**

   ```bash
   cp .env.example .env
   ```

2. **Point to your local Node API server:**

   ```env
   EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
   ```

3. **If you run the Python optimizer and/or Overture extract locally**, set in `.env`:

   ```env
   EXPO_PUBLIC_OPTIMIZER_URL=http://localhost:8000
   EXPO_PUBLIC_OVERTURE_EXTRACT_URL=http://localhost:9000
   ```

   And in the **Node server** `.env` (so `/api/optimize` and `/ws/extract` proxy correctly):

   ```env
   OPTIMIZER_BACKEND_URL=http://localhost:8000
   EXTRACT_WS_UPSTREAM=http://localhost:9000
   ```

4. **Run backend and frontend:**
   - Start the Node server: `pnpm run dev:server` (port 3000).
   - Start the Python optimizer if used: e.g. `cd backend && uvicorn app.main:app --reload --port 8000`.
   - Start the extract service if used (see backend docs).
   - Start the app: `pnpm run dev` (web on port 19007; it will use `http://localhost:3000` for API).

The app will talk to your local backend; no Railway or Vercel backend required.
