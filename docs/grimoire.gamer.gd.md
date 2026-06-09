# Deploy to http://grimoire.gamer.gd/

Single-domain setup for [GrimoireVTT](http://grimoire.gamer.gd/).

## URLs

| What | URL |
|------|-----|
| App | http://grimoire.gamer.gd/ |
| API | http://grimoire.gamer.gd/api/... |
| Health | http://grimoire.gamer.gd/health |
| Sockets | http://grimoire.gamer.gd/socket.io/ |

---

## Server `.env` (required values)

```env
CLIENT_URL=http://grimoire.gamer.gd
TRUST_PROXY=1
NODE_ENV=production
PORT=3001
```

Copy the full template: `apps/server/.env.production.example` → `apps/server/.env` and fill in DB/Redis/Mongo/Clerk secrets.

---

## Client build

`apps/client/.env.production` is already set for this domain (no `VITE_SERVER_URL`).

When you switch Clerk to **production**, replace `VITE_CLERK_PUBLISHABLE_KEY` with your `pk_live_...` key.

```bash
pnpm install
pnpm build
```

Static files: `apps/client/dist`

---

## Clerk

1. [Clerk Dashboard](https://dashboard.clerk.com) → your application → **Domains**
2. Add: `http://grimoire.gamer.gd`
3. If Clerk requires HTTPS for production keys, enable SSL on the host first (see below)

---

## Nginx

Use the ready-made config:

```bash
# on your VPS — adjust `root` path inside the file first
sudo cp deploy/nginx/grimoire.gamer.gd.conf /etc/nginx/sites-available/grimoire.gamer.gd
sudo ln -sf /etc/nginx/sites-available/grimoire.gamer.gd /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Run API (keep alive with PM2 or systemd)

```bash
cd apps/server
pnpm db:migrate   # first deploy only
node dist/index.js
```

Example PM2:

```bash
pm2 start dist/index.js --name grimoire-api --cwd /var/www/grimoire-vtt/apps/server
pm2 save
```

---

## Verify

```bash
curl http://grimoire.gamer.gd/health
```

Expected: `{"status":"ok","timestamp":"..."}`

Then open http://grimoire.gamer.gd/ — sign in, create a campaign, start a session.

---

## HTTPS (optional later)

If [gamer.gd](https://gamer.gd) or your host offers TLS, update:

- `CLIENT_URL=https://grimoire.gamer.gd`
- Clerk domain to `https://...`
- nginx `listen 443 ssl` + certificates

The app code already supports both `http` and `https` via `CLIENT_URL`.
