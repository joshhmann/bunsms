# Native WZ release pipeline

This is an offline exact-node content builder, **not** a live-server installer. It never writes the source corpus, deployed WZ, database, or current public release. Artifacts are candidates until the native-client owner has exercised them and the server owner has accepted the XML overlay.

## Source pins

- Complete GMS v83 installer: `MapleGlobal-v83-setup.exe`, SHA256 `1a1128ac97e11c7845aacec1a5484e650558a67da94b94147d72292e1568366d`. The executable contains two concatenated CAB volumes. Extracting the first volume alone silently leaves an incomplete native installation; `extract_stock.py` materializes both named volumes and requires successful 7-Zip extraction.
- Native PKG1/IMG format reference: [MapleLib](https://github.com/lastbattle/MapleLib/tree/93099ab42c3225272432c3da8942024153a5ffab), particularly `WzBinaryReader`, `WzBinaryWriter`, `WzDirectory`, `WzImageProperty`, `WzMutableKey`. `native_wz.py` is a new strict Python implementation of the v83 format, not the old copy-only `../wz_patcher.py`. Unsupported tags and malformed lengths fail closed. It supports GMS/MSEA/unencrypted image strings and canonicalizes List.wz-encrypted compressed canvases without changing their pixel payload.
- Feature payload archives and exact selected members are recorded by `intake_features.py` / `intake_boss.py`, not assumed from guide filenames. Source data and existing reports are evidence, never authorization to execute bundled scripts.
- Prism artwork is authored by `author_prism.py` when no original window art is available. Its manifest explicitly distinguishes original procedural UI artwork from the externally sourced real item icon. Dimensions and UOLs follow `INTEGRATION (2).md` and the DLL owner's confirmed contract. It does not claim to reproduce the absent original canvas.

Python requires Pillow and PyCryptodome; archive tools require 7-Zip. No Windows installation is needed for the builder. Actual client rendering is a separate native acceptance step.

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
