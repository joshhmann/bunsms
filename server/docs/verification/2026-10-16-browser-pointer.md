# Browser pointer receipt — 2026-10-16

Source pin: dev `JourneyClient.js 31f9ca8a` / `JourneyClient.wasm 090715ad`
(pre-`b8bfc93`; hardening never deployed). Method: trusted CDP `page.mouse`
clicks at same-frame measured centers on `https://dev.buns.asslorde.com`;
fresh disposable account; world-select + char-select images viewed by
parent. Full step JSON (durable at time of run):
`/tmp/shared/pointer-proof/browser-pointer-proof.json`.

Observed: ID field focus + typing visible; PW masked dots rendered; Login
pill → world list; Go pill → char select; Start on empty slot → creation
screen. The alleged CSS→logical Y-leg defect was a false diagnosis — no
mapping fix was necessary (`46dfd6c` reverted the behavior-preserving
hardening; backlog ticket 1 `[x]` via `d7c1977`).

No inventory/shop/storage/persistence/broad parity acceptance claimed. The
real screen-transition textfield defocus found later belongs to ticket 2
(fix `5e8b6d7`, not in release-integration tip).
