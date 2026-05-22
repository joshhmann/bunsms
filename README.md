# 🍑 BunsMS

A MapleStory v83 private server powered by an AI Game Master. Forked from [AugurMS](https://github.com/themrzmaster/augurms), built on [Cosmic](https://github.com/P0nk/Cosmic).

## What's Different

- **Full rebrand** — BunsMS identity, "The Baker" AI oracle
- **Local NX proxy** — game assets served at LAN speed, no R2 dependency
- **WSS native** — WebSocket over TLS via Caddy, no mixed content issues
- **Docker Compose** — separate test stack with shifted ports
- **Web client** — browser-playable MapleStory at buns.asslorde.com
- **Dashboard** — Next.js 15 admin panel with character/item/map/drop management

## Quick Start

```bash
docker compose -f docker-compose.test.yml up -d
```

| Service | Port |
|---|---|
| Game Server | 9494 (login), 7676-7678 (channels) |
| Dashboard | 3001 |
| Web Client | 8080 |
| MySQL | 3309 |

## Credits

- [Cosmic](https://github.com/P0nk/Cosmic) — base server
- [AugurMS](https://github.com/themrzmaster/augurms) — AI Game Master + dashboard
- [maplestory-wasm](https://github.com/themrzmaster/maplestory-wasm) — browser WASM client
