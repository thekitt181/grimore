# GrimoireVTT

A full-featured, cinematic D&D 5e Virtual Tabletop application with a dark fantasy aesthetic.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **2D Map**: PixiJS (WebGL)
- **3D Map**: React Three Fiber + Three.js
- **State**: Zustand
- **Realtime**: Socket.io
- **Backend**: Node.js + Express + Prisma ORM
- **Database**: PostgreSQL
- **Cache**: Redis
- **Auth**: Clerk
- **Media**: WebRTC + Howler.js

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL (local or cloud)
- Redis (local or cloud)
- Clerk account (https://clerk.dev)

### Setup

```bash
# Install dependencies
pnpm install

# Copy env files
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env

# Edit both .env files with your credentials

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate

# Start development servers (client + server in parallel)
pnpm dev
```

### Owlbear compendium (Phase 4)

Uses the same MongoDB as `owlbear_dnd_extension`. Set `MONGODB_URI` in `apps/server/.env`, then:

```bash
pnpm --filter @grimoire/server import:compendium
```

Edits and **new custom monsters/items/spells** created in Grimoire save to the shared `data.global` document (`monsters[]`, `items[]`, `spells[]`, plus `images`/`imagesData`) so the Owlbear extension picks them up on its next sync poll.

### D&D Beyond (Phase 9)

Uses Cobalt session token + server proxy (no public OAuth). Set `DDB_TOKEN_ENCRYPTION_KEY` in `apps/server/.env`. See [docs/DDB_SETUP.md](docs/DDB_SETUP.md) for linking your account, importing PCs, HP sync, and the roll bridge.


| Service | Port |
|---------|------|
| Client  | 5173 |
| Server  | 3001 |

## Production deployment

**Single domain (recommended):** [docs/SINGLE_DOMAIN.md](docs/SINGLE_DOMAIN.md) — one URL for app, API, and websockets.

Full options (including two-domain): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Nginx example: `deploy/nginx/single-domain.conf.example`.

## Build Phases

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Foundation (auth, campaigns, realtime) | ✅ Complete |
| 2 | 2D Map Engine (PixiJS, grid, tokens) | 🔜 Next |
| 3 | Fog of War + LOS ray-casting | 🔜 |
| 4 | Monster Dex + Owlbear compendium (MongoDB) | ✅ Complete |
| 5 | Combat System + 3D Dice | 🔜 In progress |
| 6 | GM Tools + DM Screen | 🔜 |
| 7 | Scene & Storytelling Tools | 🔜 |
| 8 | Player Character Panel | ✅ (via Phase 9 PC sheet) |
| 9 | D&D Beyond Integration | ✅ Complete |
| 10 | 3D Map Mode (Three.js) | 🔜 |
| 11 | Custom Dice Skins | 🔜 |
| 12 | Polish & Performance | 🔜 |

## Project Structure

```
grimoire-vtt/
├── apps/
│   ├── client/          # React + Vite frontend
│   └── server/          # Node.js + Express backend
└── packages/
    ├── shared/          # Shared TypeScript types + constants
    ├── dice-engine/     # Dice rolling logic
    ├── fog-engine/      # Ray-casting fog of war
    └── monster-dex/     # Monster data layer
```
