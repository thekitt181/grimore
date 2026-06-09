# Deploying GrimoireVTT to the web

GrimoireVTT supports two common layouts:

| Layout | App URL | API / sockets | When to use |
|--------|---------|---------------|-------------|
| **Single domain** | `https://grimoire.example.com` | Same host (`/api`, `/socket.io`) | Simplest — one DNS name |
| **Two domains** | `https://app.example.com` | `https://api.example.com` | CDN/static host separate from API |

Example nginx configs live in [`deploy/nginx/`](../deploy/nginx/).

---

## 1. Prerequisites

- Node 20+, pnpm 9+
- PostgreSQL, Redis, MongoDB (compendium)
- [Clerk](https://clerk.dev) production application
- TLS certificates (Let's Encrypt recommended)
- Server process manager (systemd, PM2, Docker, etc.)

---

## 2. Build

```bash
pnpm install
pnpm --filter @grimoire/shared build
pnpm build   # builds server + client
```

Client output: `apps/client/dist`  
Server output: `apps/server/dist`

---

## 3. Environment variables

### Server (`apps/server/.env`)

```env
NODE_ENV=production
PORT=3001
TRUST_PROXY=1

DATABASE_URL=postgresql://...
REDIS_URL=redis://...
MONGODB_URI=mongodb+srv://...

CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...

# Browser origin(s) — comma-separated if you have app + www
CLIENT_URL=https://app.grimoire.example.com
# CLIENT_URLS=https://app.grimoire.example.com,https://www.grimoire.example.com

COMPENDIUM_MONGO_ONLY=1
COMPENDIUM_ADMIN_PASSWORD=your-strong-password
DDB_TOKEN_ENCRYPTION_KEY=your-long-random-secret
```

### Client (build-time — `apps/client/.env.production`)

**Single domain** (API on same host):

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
# VITE_SERVER_URL unset — uses /api on same origin
```

**Two domains**:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_SERVER_URL=https://api.grimoire.example.com
VITE_APP_URL=https://app.grimoire.example.com
```

Build with production env:

```bash
pnpm --filter @grimoire/client build
```

---

## 4. Clerk dashboard

In Clerk → **Domains**, add every public URL players use:

- `https://grimoire.example.com` (single domain), or
- `https://app.grimoire.example.com` (two-domain setup)

Add the same URLs under **Allowed redirect URLs** if you use OAuth redirects.

---

## 5. Run the API

```bash
cd apps/server
pnpm db:migrate   # first deploy only
node dist/index.js
```

Optional: serve the built client from Node (no nginx for static files):

```env
SERVE_CLIENT=1
# or CLIENT_DIST_PATH=/var/www/grimoire-vtt/apps/client/dist
```

---

## 6. Reverse proxy (recommended)

Copy and edit an example from `deploy/nginx/`:

- **One domain:** `single-domain.conf.example`
- **App + API:** `two-domains.conf.example`

Reload nginx, then verify:

```bash
curl https://api.grimoire.example.com/health
# or
curl https://grimoire.example.com/api/../health  # use /health on API upstream
```

(`GET /health` is on the API server root, not under `/api`.)

---

## 7. DNS checklist

| Record | Points to | Used for |
|--------|-----------|----------|
| `grimoire.example.com` | Your server IP | Single-domain setup |
| `app.grimoire.example.com` | Static/nginx | Two-domain app |
| `api.grimoire.example.com` | API/nginx | Two-domain API + websockets |

---

## 8. Quick local production smoke test

```bash
# Terminal 1 — API + optional static
cd apps/server
SERVE_CLIENT=1 CLIENT_URL=http://localhost:4173 node dist/index.js

# Terminal 2 — or use built files via nginx
pnpm --filter @grimoire/client preview
```

Open the preview URL, sign in, create a campaign, join from a second browser.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| CORS errors | `CLIENT_URL` must exactly match the browser URL (scheme + host, no trailing slash) |
| Socket never connects | Proxy `/socket.io` with WebSocket upgrade headers; set `VITE_SERVER_URL` in two-domain builds |
| Invite links wrong | First entry in `CLIENT_URL` / set `VITE_APP_URL` |
| 502 on `/api` | API not running on `PORT`; check `upstream` in nginx |
