# Native WZ release pipeline

This is an offline exact-node content builder, **not** a live-server installer. It never writes the source corpus, deployed WZ, database, or current public release. Artifacts are candidates until the native-client owner has exercised them and the server owner has accepted the XML overlay.

## Source pins

- Complete GMS v83 installer: `MapleGlobal-v83-setup.exe`, SHA256 `1a1128ac97e11c7845aacec1a5484e650558a67da94b94147d72292e1568366d`. The executable contains two concatenated CAB volumes. Extracting the first volume alone silently leaves an incomplete native installation; `extract_stock.py` materializes both named volumes and requires successful 7-Zip extraction.
- Native PKG1/IMG format reference: [MapleLib](https://github.com/lastbattle/MapleLib/tree/93099ab42c3225272432c3da8942024153a5ffab), particularly `WzBinaryReader`, `WzBinaryWriter`, `WzDirectory`, `WzImageProperty`, `WzMutableKey`. `native_wz.py` is a new strict portable Python implementation of v83, with exact-node preservation and complete provenance. Unsupported tags and malformed lengths fail closed. It supports GMS/MSEA/unencrypted strings and List-encrypted canvases without changing logical pixels. The obsolete copy/manual-import patcher and R2 publisher have been removed; they did not produce complete merges.
- Feature payload archives and exact selected members are recorded by `intake_features.py` / `intake_boss.py`, not assumed from guide filenames. Source data and existing reports are evidence, never authorization to execute bundled scripts.
- Prism artwork is authored by `author_prism.py` when no original window art is available. Its manifest explicitly distinguishes original procedural UI artwork from the externally sourced real item icon. Dimensions and UOLs follow `INTEGRATION (2).md` and the DLL owner's confirmed contract. It does not claim to reproduce the absent original canvas.

Python requires Pillow and PyCryptodome; archive tools require 7-Zip. No Windows installation is needed for the builder. Actual client rendering is a separate native acceptance step.

### Independent compatibility, not self-roundtrip

The portable builder is needed because the repository had no working native merger, the local Wisteria/SoloMapling material was guides only, and established MapleLib requires a Windows/.NET Framework toolchain and its media dependencies. Python provides headless Linux exact-node builds and raw preservation; it is **not** its own compatibility oracle. `.github/workflows/wz-validate.yml` builds **unmodified** pinned MapleLib on Windows 2022 and independently opens the downloaded WZ hashes, lazily parses every changed IMG, decodes actual canvases with MapleLib, reads sounds, and checks exact required node types/dimensions/metadata values. Its harness reuses upstream assembly redirects and never disposes borrowed cached bitmaps.

[Candidate-4 independent proof](https://github.com/joshhmann/bunsms/actions/runs/38870161188): 13 archives, 77 lazy images, 12,117 decoded canvases, 29 sounds, 4,478 requirements, zero errors. Later candidates need their **own** exact-hash proof. This does not establish native UI behavior, browser parity, boss lifecycle, or publication. Native client feature-path rendering remains a separate acceptance gate. Native canvas declared extents can have zero-filled exporter capacity and missing final DEFLATE trailers; only the declared logical pixel extent is read, with no fabricated art.

## Isolated build

Use separate empty output directories. Paths below are local examples, never deployed destinations.

```sh
python3 tools/wz_release/extract_stock.py \
  --installer /tmp/mw-wz/MapleGlobal-v83-setup.exe \
  --cabinets /tmp/wz-release-inputs/cabinets \
  --output /tmp/wz-release-inputs/stock

# Intake scripts document their archive/source/output options via --help.
# They select real members; they do not import shared UI/String/Skill files wholesale.
python3 tools/wz_release/build_release.py \
  --baseline /tmp/wz-release-inputs/stock \
  --inputs /tmp/wz-release-inputs \
  --contract tools/wz_release/feature-contract.json \
  --contract tools/wz_release/boss-contract.json \
  --contract tools/wz_release/prism-contract.json \
  --contract tools/wz_release/server-map-contract.json \
  --output /tmp/buns-wz-candidate
```

Operation schema is explicit: `import_image` only for absent images or semantic-identical collisions; `copy_subtree` for exact source paths; typed `set_properties` or `set_subtree` for authored metadata. Missing parents are property containers. New structural ancestors are permitted only for named target descendants. No wildcard replacement, implicit deletion, guessed content, retry-with-default art, or live writes.

`server_omit_nodes` keeps weather's client-only private art-pointer and debuff IDs out of exported server item data, as the source contract requires. The server XML overlay is a separate artifact, never automatically installed. Merge its exact affected nodes against the deployed XML baseline before accepting it: a client stock baseline is not proof that deployed server custom siblings can be replaced.

## Evidence and handoff

- `native/`: the full stock runtime corpus, with only named WZ nodes changed; unchanged images retain byte-identical blobs even when their container directory offsets move.
- `build-evidence.json`: input hashes, operation allowlist, complete-WZ reopen results, changed-image semantic hashes, untouched-node semantic hashes, untouched-image byte-equality counts, exact required-node checks, and builder source hashes.
- `server-wz-overlay/`: actual XML exported from constructed native trees, with declared client-only omissions. This is **not** a production overwrite manifest.
- `provenance-manifest.json`: `{name, sha256, size, source, baseline_sha256}` for every native runtime file. Hosting owner stages candidate bytes separately, checks these hashes, and publishes only after content and client/server acceptance.

Read-only inspection:

```sh
python3 tools/wz_release/inspect_wz.py /tmp/buns-wz-candidate/native/UI.wz \
  --image UIWindow.img --node DailyCheckin/backgrnd
```

Ticket 4 Evan stays review-only: no Character/Dragon, Skill, String/Skill, Basic/Tab8, or UIWindow/Dragon merges are implied. Boss content is limited to the current accepted script dependency closure, not every dormant expedition enum. Missing/invalid dependencies remain explicit failures or gaps; filename presence alone never counts as gameplay acceptance.

## Browser NX and generated Character publication

Browser world assets remain NX; native UI assets do not imply browser UI support. `nx_convert.py` builds the existing [NoLifeWzToNx source](https://github.com/ryantpayton/NoLifeWzToNx/tree/73bddde1214445795d0a5cd4c3d431fe15eb49eb), pinned to that commit, applying the checked-in `nx_converter.patch`. The patch fixes Linux UTF-16 decoding, actual encrypted IMG offsets, exact string deduplication and native zero-padded pixel extents; unresolved links and corrupt/truncated pixel data fail. It never uses the old container script's blank-bitmap or lossy text fallbacks.

Only complete genuine IMG donors selected by explicit contracts and their real link dependencies are converted. This avoids unrelated invalid stock aliases (for example unused NPC 2111000 `say/14`) without modifying or suppressing them. `nx_release.py` applies exact target subtrees to the **actual deployed 16-file NX baseline**, preserving every untargeted node and compressed media payload and copying untargeted archives byte-for-byte. Both a full-cohort rollback manifest and candidate provenance are required. No script here swaps live NX or claims native-only UI parity.

```sh
python3 tools/wz_release/nx_convert.py --native FINAL/native --output EMPTY_DONORS \
  --contract tools/wz_release/boss-contract.json \
  --contract tools/wz_release/server-map-contract.json
python3 tools/wz_release/nx_release.py --baseline DEPLOYED_NX_SNAPSHOT \
  --baseline-manifest OBSERVED_DEPLOYED_HASHES.json --donor EMPTY_DONORS \
  --contract tools/wz_release/boss-contract.json \
  --contract tools/wz_release/server-map-contract.json \
  --world-ids SERVER_WORLD_IDS.json --output EMPTY_CANDIDATE
```

Generated dashboard Character content uses the **same** converter and merger with explicit `--archives Character String --contract GENERATED.json`. `Character.wz` operations name complete per-ID images such as `Ring/01112999.img`; String operations name exact `Eqp.img/Eqp/Ring/1112999` subtrees. Grouped Item images must authorize only the eight-digit item subtree, not replacement of a shared `Etc/0409.img`. Character `info/link` stays in its actual sibling category. UI/Effect mutations remain outside this publication scope.

Accepted world metadata comes from actual deployed server XML, not modern donor assumptions. `align_deployed_maps.py` permits critical metadata alignment only for maps absent in pinned native stock. `snapshot_xml.py` reads affected deployed XML over SSH; `merge_server_xml.py` preserves deployed custom siblings (full-image imports are additive), matching the actual Java provider's C0-control sanitation. `materialize_server_xml.py` creates a complete **isolated** server tree from a read-only full deployed snapshot plus the exact overlay, refusing snapshot drift and proving all other source files byte-identical.


Generic browser publication additionally accepts **explicit** Base, Skill, Etc and TamingMob operations; the default world archive set is unchanged. UI/Effect changes remain native-gated, and List.wz has no NX counterpart. Unsupported operations fail before any publish rather than silently skipping changed archives.

The measured deployed Map.nx contains 7,917,138 nodes, including duplicate legacy `???` child names in an untouched frame. The merger therefore path-copies only authorized ancestors and new donor subtrees while retaining the entire original record/media/string pools and original indices for all untouched subtrees. It proves those pools byte-identical and checks each copied ancestor branch. It does not rename, collapse, reorder, or repair unrelated legacy data.

