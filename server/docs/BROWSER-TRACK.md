# BROWSER TRACK — STATUS: DEFERRED (user decision 2026-10-16)

Browser runtime/testing/build expansion is STOPPED. AFTER-pair slot24 smoke
is deferred. Windows build + server is the single active focus. This file is
the durable checkpoint; the browser branch and artifacts below are SAVED,
not feature-DONE.

## Pins
- Engine pin: `8eece1d` (web-client/vendor/maplestory-wasm, gitlink unchanged)
- Source commit: `29deb8d3f6ae01b23de69b4f31ff037bbb031622`
  (branch `inventory-equipment-slot24`, base `fc2bf94`)
- Prior normal-pointer false bug: done `46df` (operator error, distinct)
- Focus-guard source `5e8b6d7` included; broad parity NOT done

## 8-patch stack (Dockerfile order) + build command
1. remote-movement.patch
2. deployed-npc-chat.patch
3. browser-modernization.patch
4. focus-guard.patch
5. nx-bitmap-decoder.patch
6. inventory-equipment.patch
7. inventory-equipment-slot24.patch (29deb8d; inclusive final-slot fix)
8. shop-storage.patch (incl. BuyState::draw soldout-param fix)

Build: emsdk pinned `631841e7`, `./scripts/build_wasm.sh --jobs 4`
(builder-owned Dockerfile; slot24 apply line added in this checkpoint —
coordinate with inventory-slice-build, the staging/build owner).
Note: this checkpoint worktree's Dockerfile ADDS the slot24 apply line
that the builder's staging tree already had; builder is source of truth
for the staged build record.

## Saved whole-pair — private-root exchange only
- JS: `6b3e7eef6ea35ce3002ff5b66c9ed87f7ed1801cc785978f3a05b169006bcf04`
  (unchanged vs pre-fix pair — render-only C++ delta, no JS glue change)
- WASM: `271af6075b9137c021c35ea570a40e093c22ff975316ce2f9191f41e5cffaa79`
- Persisted at `/root/buns-checkpoints/browser/2026-10-16/`
  (JourneyClient.SLOT24.js/.wasm + MANIFEST.txt + RED evidence text;
  no NX/world/prod data copied)
- Codec `801543b6` is separate historical proof (`7528389`, 2165px, 16NX,
  HTTP) — not this build

## Evidence state
- Last-slot RED (public, char4): full frames show slot24 present in model
  + server memory, USE grid empty after ETC→USE redraw
  (see `inventory-slot24-public-red-evidence.txt` in checkpoint dir)
- Native: public-Inventory red→green PROVEN (pristine assert abort →
  patched `slot24 model seams ok` + full `test_modernization` green)
- Authorized PRIVATE `18081` root exchanged before stop at **2026-10-16T10:53:46Z**.
  Full HTTP JS `6b3e7eef...` / WASM `271af607...` hashes were proven.
  This was private-root only; production/development roots remained unchanged.
- AFTER new-pair UI login/click, slot24 redraw visibility and shop final capacity:
  **NOT OBSERVED** before stop; no AFTER UI pass is claimed.

## Resume steps (only when user resumes browser work)
1. Reuse the saved exact pair/source pins; only rebuild if deliberately changing bytes.
2. Initial slot24 visibility on same character.
3. ETC→USE tab redraw keeps slot24.
4. Relog persistence.
5. Shop buy fills final capacity.
6. Storage deposit/withdraw + equip flows.
7. Full economy walkthrough still open — NOT done from the slot24 fix.

## Pointers
- Checkpoint branch (this doc + Docker line): `checkpoint/browser-2026-10-16`
- Source branch: `inventory-equipment-slot24` @ `29deb8d`
- Artifacts: `/root/buns-checkpoints/browser/2026-10-16/`
- Windows active work: CURRENT/BACKLOG (separate)
- Proper checkpoint worktree: `/tmp/buns-browser-track`, parent
  `29deb8d3f6ae01b23de69b4f31ff037bbb031622`. This is a real linked worktree,
  not the unrelated two-file root commit in `/tmp/buns-browser-checkpoint`.
- All eight source patches/tests remain inherited from the real parent.
  No browser runtime/build/test was run for this metadata checkpoint.
