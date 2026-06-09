# Single-domain deployment

Everything runs on **one URL**, e.g. `https://grimoire.yoursite.com`:

| Path | What |
|------|------|
| `/` | React app (static files) |
| `/api/*` | Express API |
| `/socket.io/*` | Realtime (sessions, map, dice) |
| `/health` | API health check |

---

## 1. DNS

Point your domain A record at your server IP:

```
grimoire.yoursite.com  →  YOUR_SERVER_IP
```

---

## 2. Server env (`apps/server/.env`)

```env
NODE_ENV=production
PORT=3001
TRUST_PROXY=1

DATABASE_URL=postgresql://...
REDIS_URL=redis://...
MONGODB_URI=mongodb+srv://...

CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...

CLIENT_URL=https://grimoire.yoursite.com

COMPENDIUM_MONGO_ONLY=1
COMPENDIUM_ADMIN_PASSWORD=your-strong-password
DDB_TOKEN_ENCRYPTION_KEY=your-long-random-secret
```

Replace `grimoire.yoursite.com` with your real domain (no trailing slash).

If you also use `www`, add both:

```env
CLIENT_URLS=https://grimoire.yoursite.com,https://www.grimoire.yoursite.com
```

---

## 3. Client build env (`apps/client/.env.production`)

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

**Do not set `VITE_SERVER_URL`** — production uses `/api` on the same domain.

```bash
cp apps/client/.env.production.example apps/client/.env.production
# edit VITE_CLERK_PUBLISHABLE_KEY

pnpm install
pnpm build
```

---

## 4. Clerk

In [Clerk Dashboard](https://dashboard.clerk.com) → your app → **Domains**:

- Add `https://grimoire.yoursite.com`
- Use **production** keys (`pk_live_` / `sk_live_`) in env files

---

## 5. Nginx

Copy [`deploy/nginx/single-domain.conf.example`](../deploy/nginx/single-domain.conf.example):

1. Replace `grimoire.example.com` with your domain
2. Set `root` to your `apps/client/dist` path
3. Add SSL paths (Certbot/Let's Encrypt)

Enable and reload:

```bash
sudo ln -s /path/to/single-domain.conf /etc/nginx/sites-enabled/grimoire
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Run the API

```bash
cd apps/server
pnpm db:migrate    # first time only
node dist/index.js
```

Use systemd, PM2, or Docker to keep it running. The API listens on `127.0.0.1:3001`; nginx proxies public HTTPS to it.

**Alternative:** skip nginx for static files and let Node serve the build:

```env
SERVE_CLIENT=1
```

Then nginx only needs to proxy to port 3001 (or expose 3001 with TLS via a tunnel).

---

## 7. Verify

```bash
curl https://grimoire.yoursite.com/health
# {"status":"ok","timestamp":"..."}

# Open in browser — sign in, create campaign, open a session
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CORS error | `CLIENT_URL` must match the browser URL exactly (`https://`, no trailing `/`) |
| WebSocket failed | nginx `location /socket.io/` must include `Upgrade` + `Connection` headers (see example config) |
| `/api` 502 | API not running on port 3001 |
| Blank page after deploy | Run `pnpm build`; check nginx `root` points at `apps/client/dist` |

See also [DEPLOYMENT.md](./DEPLOYMENT.md) for two-domain setup and more detail.
