# BunsMS dashboard

Next.js 15 / React 19 private administration and AI Game Master for Cosmic v83.
The measured application host is LXC 164 (`192.168.0.164`), behind the existing
`.70` Caddy edge. The public domain remains `https://buns.asslorde.com`.

## Exposure

The public edge preserves the browser root/WSS and asset service. Only launcher
manifest/news and server-status read APIs are forwarded to this dashboard.
Administration, GM tools, uploads, publication, migration and game control stay
private and authenticated. Do not publish a dashboard/control port or use a
public origin as a write endpoint.

The admin UI provides characters/items/mobs/maps/drops/config/scripts, generated
art/reactors, and the streaming AI Game Master. JWT/session and private GM-secret
authentication apply to mutation APIs. Large streaming upload handlers perform
authentication themselves because Next middleware otherwise clones/buffers the
request body before route execution.

## Asset publication

Read [the complete selfhost operating contract](../server/docs/SELFHOST-ASSETS.md)
before deployment or publication. All affected producers use one independently
expected-hash-verified immutable-object/retained-manifest transaction, including
art, raw WZ, GM, item/assets/Baker/reactor jobs, server overlays and actual browser
NX conversion. There is no R2 runtime fallback, direct-live rsync registration,
URL-only publish, duplicate local-publish route or manual byte-copy rollback.

- `GET /api/launcher/manifest` defaults to stock. Kaentake is explicit opt-in.
- The private authority supplies the complete writer allowlist, not a filtered
  public manifest.
- The first release preserves every approved seed byte/version/timestamp;
  later updates retain prior complete SELFHOST manifests and immutable bytes.
- Generated files and Browser NX become visible through the same manifest
  switch. A dispatched conversion/background job is not publication success.
- Private server apply is acknowledged separately; failure does not set a
  publication job/DB flag to done. Progress lives under the shared asset mount,
  not `/cosmic` in the image filesystem.
- `GAME_SERVER_HOST=server` is internal health only.
  `GAME_CLIENT_HOST=buns.asslorde.com` is the explicit advertised production
  client domain; unset means the API omits it. Local `.164`/loopback overrides
  remain supported. Public native activation deferred by owner.

## Development and source deployment

```sh
npm install
npm run dev
```

Configure actual `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, JWT/admin
credentials and model-provider configuration for the intended isolated/private
stack. Do not copy example/test credentials into production or print them.
`COSMIC_ROOT` is a local server-source/config setting, not the shared asset or
manifest authority.

Use the repository's `docker-compose.test.yml` and `deployment/` templates with
operator-provisioned environment/secret files. Required shared storage is
`ASSET_DIR` plus the writable **directory** containing `LAUNCHER_MANIFEST_PATH`;
UID 1001 must be able to create temporary files and atomically rename within it.
Mounting one read-only JSON file is not supported. The private Unix control
socket and persistent game overlay-state directory are separate mounts.

The pinned WZ tools and approved native/NX provenance inputs are required for
real content publication. CI uses provisioned private SSH/known-host credentials
and an actually reachable runner; missing configuration fails closed. It does
not use Fly, a public mutation tunnel, or a made-up self-hosted runner. DB/schema,
Java/content and browser-NX activation remain their separately approved gates.

## Focused verification

```sh
npx tsc --noEmit
bun test test/assets.test.ts test/game-control.test.ts test/server-strings.test.ts
```

`test/assets.integration.test.ts` additionally requires explicit approved native
WZ/NX directories and hash manifests, the pinned real converter tools, and a
real server tar; it must not silently substitute mock conversion. It exercises
actual production publishers, full NX readback and retained rollback against
isolated storage/SQL. `test/production-stream.mjs` runs inside the actual built
Node20 standalone image and checks real HTTP publication/rollback plus bounded
memory for a 500 MiB upload. These are isolated service tests, not a claim of
Windows gameplay, public native connectivity, or live Java/DB activation.
