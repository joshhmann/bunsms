# Self-hosted asset publication and serving

## Authority and network contract

The source implementation uses the measured LXC `192.168.0.164` application host
and `.70` Caddy edge. It does not use R2 or Fly for asset reads, publication,
conversion, game-overlay application, or rollback. Original R2 objects must not
be deleted; they are not a runtime fallback or a rollback mechanism.

- Public bytes: the existing aiohttp service, `/client/<key>` and
  `/client/r/<sha256>/<key>`, including nested art and server tar files.
- Public launcher reads: `/api/launcher/manifest`, `/api/launcher/news`, and
  `/api/server`. Caddy forwards read methods only; admin/GM/control writes are
  not public routes. Keep the existing browser-root/catchall and WSS routing.
- Private publisher: authenticated LAN dashboard, normally
  `http://192.168.0.164:3001`; JWT session or `x-gm-secret` authentication is
  required. The CLI rejects public/non-private origins. Never put credentials
  in URLs, source, logs, or examples.
- Private game/converter control: authenticated Unix socket only, not an HTTP
  listener on another public/LAN port.
- `GAME_SERVER_HOST=server` is the internal Docker health target.
  `GAME_CLIENT_HOST=buns.asslorde.com` is the explicit production advertised
  native-client hostname; if unset the API omits the client-host field.
  Explicit `192.168.0.164`/`127.0.0.1` test overrides remain valid.
  **Public native activation deferred by owner.** Advertising the domain does
  not prove external native TCP connectivity. No Tailscale, NAT, or public-port
  changes are part of this repair.

This document describes the committed source protocol. A previous live serving
receipt or the old `selfhost-assets` branch is not evidence that a new repair
commit has been built, deployed, or activated. Java/DB/schema/live browser-NX
changes require the relevant owner gates; isolated tests do not authorize them.

The current target is the full accepted **Windows TESTING RC plus a matching
Linux test server**, not an unverified production switch or a Windows backend
requirement. `/rc-assets/` is the approved read-only QA prefix on the canonical
domain; sealed candidates there do not activate production Java/DB/browser/NX.
Exact current pins, exercised receipts and holds are in `CURRENT-STATE.md` and
the single-writer release coordination contract.

## One immutable release boundary

`dashboard/src/lib/assets.ts` is the shared storage/manifest authority for every
publisher, not just the CLI. The durable layout under `ASSET_DIR` is:

| Location | Purpose |
| --- | --- |
| `objects/<sha256>/<key>` | Verified read-only immutable bytes |
| `staging/<releaseId>/` | Private candidates, frozen expectations and release state |
| `manifests/<releaseId>.json` | Complete retained read-only release manifests |
| `jobs/` | Atomic persistent async-publication status |
| `nx-candidates/`, `cache/` | Private conversion output and disposable browsing caches |

Only validated retained/sealed immutable revisions are served. A sealed internal
QA view is not the active manifest. Staging, locks, release records, job status
and caches are never arbitrary static roots.
The writable manifest authority is `LAUNCHER_MANIFEST_PATH`; a bundled manifest
is only the initial approved seed. There is no legacy single-file authority or
spare Next.js byte-download route.

1. Begin a release against the current authority. Compute expected SHA-256 and
   size from the intended source **before transfer**. Browser uploads hash the
   selected file incrementally; generated jobs hash their completed output.
2. Stream/copy into unique destination-local staging files. A completed key
   cannot be overwritten; a release lock excludes upload/prepare races.
   Multipart metadata must precede file fields. The three large upload routes
   bypass body-cloning middleware but perform the same authentication in their
   handlers before consuming a byte.
3. Freeze a defensive copy of expectations and the staged file identity. Verify
   the exact detached file, once, against expected bytes/size; preserve that
   identity in the object metadata. Reusing a retained digest checks its frozen
   identity, not merely its basename or read-only mode.
4. The selected cohort is explicit. Native-only Windows publication retains its
   exact complete native-file contract without inventing a browser gate.
   A selected native-and-browser cohort runs the pinned real converter/merger,
   verifies the complete NX cohort and fails publication if conversion fails.
5. One inter-process authority lock and base-manifest compare-and-swap exclude
   stale writers. Retain the complete manifest first, then atomically replace
   the writable authority **last**. No mutable live-byte rename precedes it.
   Locks use inherited kernel file descriptors (`flock`, installed in the
   production image); process death releases them without manual lock deletion.
   Old manifest revision URLs continue to serve their exact retained bytes.
6. After commit, server-overlay publishers invoke the private game-apply
   mechanism. An apply failure reports `published` but not `applied` success;
   it does not pretend the committed manifest was never switched. Async jobs
   and DB publication flags become successful only after the required apply
   acknowledgement. Status-write failure cannot acknowledge a new job.

The first immutable release must verify **every** launcher seed entry and
preserve its approved hash/size, version, and timestamp. Bootstrap cannot be
used to skip retaining the existing release and publish different client bytes.
Subsequent client-byte changes bump the patch version; art/NX/server-only
changes do not spuriously change launcher version/timestamp.

`prepare`/`seal` can freeze a complete internal QA candidate without `commit`
or an active-pointer change. Its exact file-cohort certification does not prove
native engine/gameplay compatibility. Explicit RC versions use this same
authority's version option, never a separate mutable manifest writer.

No-profile/`?profile=stock` remains stock; Kaentake is explicit. The previously
deployed16-stock/15-Kae subset is not full Windows content/runtime coverage.
A full native catalog declares its exact names, sizes, hashes and count,
including the paired runtime, CRT and config files;19 is not a writer ceiling.
The current sealed QA example is65 files (native51 + runtime13 + config1),
unactivated and unqualified. The new RC launcher must select its explicit full
profile rather than reinterpret the legacy no-profile API.
`BunsMS.exe`/`config.ini` bootstrap names preserve the original executable and
config bytes; producer aliases are accepted only by the explicit bootstrap CLI.

Mutable aliases use revalidation. Revision URLs use immutable caching and
stat/path resolution, **not public-request hashing of large WZ files**. Range
and HEAD use the existing aiohttp file service. The WZ and server-XML explorers
read the same committed objects; their caches are not another manifest source.

Binary assets, including logical `.tar.gz` server packs, must arrive as exact
source bytes with `application/octet-stream`/`application/gzip`, exact lengths
and byte ranges, and no filename-derived `Content-Encoding:gzip` or transparent
decompression. The generic immutable route satisfies this; a `.bin` rename is
not the final transport contract. Actual HTTPS/full-file/Range/rollback evidence
is recorded separately from filesystem pins.

## Private APIs and callers

- `GET /api/admin/assets/release`: complete private manifest and writer allowlist.
- `POST /api/launcher/manifest {"stage":true,"baseReleaseId":...}`: release ID.
- `POST /api/launcher/upload`: multipart expected metadata plus streamed files,
  or JSON `{releaseId,files:[{name,path}]}` for trusted local producer paths.
  Art mode commits approved nested art keys and returns their durable URLs.
- `POST /api/launcher/manifest {releaseId,register:[{name,hash,size}],operations}`:
  prepare/convert/commit; `prepareOnly:true` seals a candidate without activation.
  Stage accepts the explicit approved native catalog/RC version. There is no
  arbitrary manifest or URL-only replacement mode.
- `POST /api/launcher/manifest {rollback:retainedReleaseId}`: select the exact
  retained SELFHOST manifest, native/art/server/NX bytes included. No byte copy
  back into mutable live paths and no R2 JSON restore.
- Raw WZ upload/register and their UI use these same release/expected-metadata
  semantics. Filesystem registration without staged identity is removed.
- Item, generic asset, Baker, and reactor publishers commit native WZ, complete
  browser NX, server tar and generated marker together. The old direct-live
  `publish-local` routes/buttons are removed; configured local deployments use
  the same publisher rather than a second unsafe publication implementation.
- Manual icons, renderers, generated item art, reactor art and Baker input use
  committed nested keys. Baker input is `assets/npc/baker-sprite.png`, not an
  ephemeral `/tmp` upload. Reactor CRUD saves drafts; it does not write live
  game XML/scripts before the publication transaction.
- The GM publish tool schema accepts actual local source paths plus independent
  expected hash/size (or a staged release), matching the real handler.
- `POST /api/admin/assets/migrate` imports independently pinned art/candidate
  files and optionally transactionally rewrites selected persisted DB URL
  fields. `records: []` is a filesystem-only import, not a schema migration.
  External/data-URL runtime fallback is deliberately rejected. Existing
  candidate aliases must be imported before switching an old flat static root.

## Real WZ → NX boundary

`tools/prepare_nx_release.py` invokes the existing WZ-release tools at
`776d80a49caadd2c9fc9552e9058948cc793b2df`, with NoLifeWzToNx pinned at
`73bddde1214445795d0a5cd4c3d431fe15eb49eb`. It verifies approved native and
observed deployed-NX inputs, uses explicit `import_image`/`set_subtree` edits,
checks coverage/preservation, and returns real immutable candidate files.
`UI.nx` remains protected; unchanged siblings and legacy duplicate node pools
are preserved. List has no NX. Fourteen convertible WZ archives are explicit;
UI/Effect remain excluded. Item ETC edits replace individual eight-digit
subtrees, not a shared bucket containing unrelated custom siblings.

The output is not merely dispatched or uploaded elsewhere: complete `nx/*`
assets join the same authority transaction and `/nx/<name>` serves those exact
committed objects. Before the first cohort commit, the approved existing local
NX baseline is unchanged. GitHub workflows invoke the same private publication
path, not an R2-to-R2 conversion or an unconfigured self-hosted runner.

## Server overlay and marker

`server-wz.version` is generated with its tar and contains release ID, immutable
URL, expected SHA-256 and size. Startup fetches the descriptor once, optionally
from immutable `WZ_VERSION_URL`; `ASSET_BASE_URL` may include the QA prefix.
The already installed curl transports opaque bytes with no retry/fallback;
Python still streams pinned size/SHA verification, rejects traversal/links/
special entries and extracts privately before touching game files. A nonzero
HTTP-client exit aborts even if a response body otherwise resembles an archive.
Partial `wz/`/`scripts/` overlays preserve unrelated baseline files. A missing
complete WZ baseline requires its independent selfhost pin, never a fallback.

`server/entrypoint.sh` retains pre-overlay originals plus a pending-apply ledger
under `/opt/server/.selfhost-assets`. Its **persistent** bind is required across
server-only container recreation. Applying a prior retained tar restores or
removes files introduced by later overlays, including scripts. Failed partial
application leaves the marker unchanged and Java unstarted; pending recovery
runs even when the requested descriptor equals the old marker. The marker is
written only after the complete verified overlay is applied. The private
systemd apply command recreates/waits for **server only**, never the DB stack.

Both existing Linux images and the coherent QA backend use the same Maven
data-only producer:932 authored YAML/TXT/CSV/binary files at their existing
loader paths, no entire Java source tree or invented replacement config.
The complete bundle extracts these before Java, never after launch or by a
manual supplement. Actual canonical-HTTPS full4fe81 application installed all
54658 exact XML payload files and started plain `java -jar`/real GMS83 listeners
on an owned internal-loopback Compose cohort. That receipt closes the actual
Linux artifact-consumer gate, not remote LAN/native login/family acceptance.
The predecessor Python HTTPS root cause remains unattributed; changing the one
HTTP client is not a claim to repair Python/TLS underneath.

## Operator deployment and publication

Use `deployment/selfhost-assets.env.example`, `docker-compose.test.yml`, the
systemd units, and `deployment/buns-private-deploy.sh` together. Preserve existing
browser static/WSS settings when adapting the measured host. The asset directory
and writable **manifest directory** must be shared by Node/aiohttp and writable
by dashboard UID 1001; do not mount only the JSON file read-only. The game-state
bind must persist separately. The Unix socket group permits the dashboard to
reach the private controller; the credential file remains private.

Install the approved pinned native PKG1 baseline/catalog before native content
publication; an observed NX baseline is required only for a selected browser
cohort. Server XML is not a native converter input. The older28,469,675-byte
0139085a baseline is a retained smaller historical fixture, **not** the actual
deployed54499-file XML snapshot or current full-content server pack. The current
source baseline tree is55a6c288…, and matched full rc3 XML/scripts tar is
3909493605 bytes/SHA4fe81ac3…. Use the exact approved current pins in the release
contract; never relabel the old small fixture as complete full-content coverage.

Bootstrap the current approved launcher set before accepting content updates;
import independently pinned existing nested candidate/art keys before replacing
the legacy flat static reader. Keep old source/runtime backups until the new
fixed commit passes independent review. Bootstrap itself does not restart Java.
The original bucket is never deleted.

```sh
# Credential already provisioned by the operator; do not print its contents.
export GM_SECRET_FILE=/etc/buns/gm-api-secret
export DASHBOARD_URL=http://192.168.0.164:3001
./tools/publish_assets.sh --bootstrap /path/to/approved-existing-assets
./tools/publish_assets.sh --operations /path/to/approved-operations.json /path/to/new-sources
./tools/publish_assets.sh --rollback RETAINED_RELEASE_ID
```

The CLI prehashes sources, transfers only the complete private allowlist into a
release, authenticates every request, and exits nonzero on failure. It never
rsyncs into live bytes or prints completion after an HTTP error. CI additionally
requires provisioned private SSH credentials/known-hosts and a verified route
from its runner to this host; absent deployment credentials fail closed. This
source does not invent a public write tunnel or promise an unverified CI route.

## Repair verification and change record — 2026-10-16

Permanent tests exercise imported production route handlers with isolated real
SQL storage, actual Python byte/Unix services, and actual CLI/GM clients; they do
not mirror route logic or manually copy rollback bytes. `dashboard/test/assets.integration.test.ts`
requires explicitly approved real native/NX inputs and the pinned converter;
it invokes all four production publishers and streams every resulting NX file
back through the real byte service, then calls the real retained rollback API.
`tools/tests/test_server_assets.py` executes the actual shell entrypoint with
isolated HTTP/filesystem fixtures and a Java-start sentinel (not a Java gameplay
claim), including partial-copy failure, rollback restoration and a403 response
with an otherwise valid tar body; all eight consumer checks pass after the clean
curl cutover. This is distinct from the actual full-HTTPS/plain-Java Compose
receipt above. The standalone Node20 production-image stream test exercises
actual Next HTTP and500 MiB with a bounded memory high-water check.

The accepted `de4d851` review is not retroactively changed by this repair. Its
per-file live rename/manual-copy rollback, stale R2/NX/server consumers,
unauthenticated/incomplete CLI, broken art/raw-WZ callers, swallowed failures,
and read-only mount instructions have been replaced by the common protocol
above. Real producer verification also fixed compact server String XML edits,
eight-digit ETC native/server keys and required `iconRaw`, and persistent job
status moved off an unwritable image path. Old throwaway cycle/smoke assertion
counts are not evidence for this implementation. Exact native file certification
or a genuine independent reader alone does **not** qualify the v83 game engine.
Native gameplay/visuals, full-family and actual bot-controller participation,
public native activation and production rollout retain their explicit gates.
Preserved browser/NX functionality is not a new Windows GUI/parity gate.
