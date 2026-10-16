# Browser hosting and asset-release boundaries

The earlier Fly/R2 deployment/conversion plan is superseded by the measured LXC
164 application host and `.70` Caddy edge. Use the existing production/development
domains and browser-root/WSS routes. Do not add Tailscale, NAT changes, public
write ports or a new public control endpoint.

## Asset authority

See [SELFHOST-ASSETS.md](../server/docs/SELFHOST-ASSETS.md) for the common immutable
publication protocol and deployment runbook. The Python service serves validated
nested native/art/server keys and retained revision URLs, supports Range/HEAD,
and never hashes a large WZ file on the public event loop. Mutable aliases
revalidate; retained revision URLs remain immutable across publication/rollback.

Browser `/nx/<name>` resolves the committed complete `nx/*` cohort after its
first publication. Until then it uses the explicitly approved existing local NX
baseline, not a remote-storage fallback. Real WZ conversion consumes the verified
candidate and checks coverage/preservation before one shared authority switch;
UI remains protected. Dispatch acknowledgement is not publication. Failed
conversion leaves the prior authority unchanged; retained SELFHOST rollback
selects exact native/art/server/NX objects without copying old bytes live.

The separate private Unix controller supplies conversion and server-only apply
commands. It is not registered on the public browser app. Source configuration
must preserve the current static-root cohort, WSS target/allowlist, and ports.
Source repair checks do not authorize changing the live browser NX cohort or
restarting Java/DB before the relevant owner gates.

## Native endpoint is a separate contract

The canonical advertised production native hostname is `buns.asslorde.com`,
distinct from Docker's internal health name `server`. Explicit LAN/loopback test
overrides remain supported. Public native activation deferred by owner; browser
HTTPS/WSS availability is not evidence of native public TCP connectivity. No
network decision remains open and no port changes are part of this repair.
