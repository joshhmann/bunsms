# CONTEXT.md — BunSMS on `solobots`

## What this is

PlayerBots + Augur fusion on branch `solobots`: soloMapling-style bots
managed through the Augur dashboard/launcher, on the stock Cosmic base.

## Vocabulary

- **soloMapling bots** — solo-play bots; the `solobots` working branch.
- **Augur** — dashboard/launcher surface (AugurMS.exe, launcher profiles).
- **Cosmic base** — stock Cosmic (HeavenMS-fork) v83 server under `server/`.
- **Desktop client** — stock EXE / Kaentake; reads `.wz` directly.
- **Browser client** — WASM build under `web-client/`; reads `.nx`
  converted from `.wz`.
- **Custom-opcode registry** — `server/docs/OPCODE_REGISTRY.md`; custom
  feature range `0x372E-0x373F` (e.g. coloring prism at `0x372E`/`0x372F`).
- **Launcher profiles** — `launcher/src/profiles.js`; `stock` default,
  `kaentake` opt-in.

## Bounded contexts

- `server/` — Java game server (Cosmic v83), opcodes, game content.
- `launcher/` — desktop launcher, client profiles, asset hosting.
- `web-client/` — browser WASM client, NX asset pipeline.

## Roadmap queue (in order)

daily check-in → Evan WZ → MapleRoot content → cash shop → prism →
damage cap → weather.
