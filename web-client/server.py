"""Combined static file server + NX proxy + WebSocket TCP proxy for the BunsMS web client.

Routes:
  GET /           -> index.html (or WS upgrade bridged to game server)
  GET /web/*      -> static /app/web
  GET /build/*    -> static /app/build
  GET /nx/*       -> NX files from local disk (NX_DIR, live systemd deploys)
  GET /healthz    -> 'ok'

The WS proxy accepts the target address as its first text message (same protocol
as the original ws_proxy.py from maplestory-wasm) but restricts the target to a
small allow-list of host:port pairs to prevent abuse.
"""

import asyncio
import hashlib
import logging
import os
from aiohttp import web, WSMsgType

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
log = logging.getLogger('buns-ms-web')

STATIC_ROOT = os.environ.get('STATIC_ROOT', '/app')
PORT = int(os.environ.get('PORT', '8080'))
NX_LOCAL_DIR = os.environ.get('NX_DIR', '/opt/buns/nx')
CLIENT_ASSETS_DIR = os.environ.get('CLIENT_ASSETS_DIR', '/opt/buns/client-assets')

# Comma-separated host:port allow list, e.g. "127.0.0.1:8484,127.0.0.1:7575,..."
# Override per-deploy via the ALLOWED_TARGETS env var.
# Default covers a local game server (login + 3 channels).
DEFAULT_ALLOWED = (
    '127.0.0.1:8484,'
    '127.0.0.1:7575,'
    '127.0.0.1:7576,'
    '127.0.0.1:7577'
)
ALLOWED_TARGETS = {
    t.strip() for t in os.environ.get('ALLOWED_TARGETS', DEFAULT_ALLOWED).split(',') if t.strip()
}

INDEX_HTML = os.path.join(STATIC_ROOT, 'web', 'index.html')


async def handle_root(request: web.Request) -> web.StreamResponse:
    """Serve index.html, or upgrade to WS and bridge to the game server."""
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return await handle_ws_proxy(request)
    return web.FileResponse(INDEX_HTML)


async def handle_ws_proxy(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=50 * 1024 * 1024)
    await ws.prepare(request)
    peer = request.remote or '?'

    # First message = target address "host:port"
    try:
        msg = await ws.receive(timeout=10)
    except asyncio.TimeoutError:
        log.warning('ws %s: handshake timeout', peer)
        await ws.close()
        return ws

    # The WASM client sends the target address as the first frame. The
    # upstream maplestory-wasm ws_proxy accepts either text or binary —
    # mirror that so the existing WASM build works unchanged.
    if msg.type == WSMsgType.TEXT:
        target_raw = msg.data
    elif msg.type == WSMsgType.BINARY:
        try:
            target_raw = msg.data.decode('utf-8')
        except UnicodeDecodeError:
            log.warning('ws %s: first binary frame is not utf-8', peer)
            await ws.close()
            return ws
    else:
        log.warning('ws %s: first frame was %s, not text/binary', peer, msg.type)
        await ws.close()
        return ws

    target = target_raw.strip()
    if target not in ALLOWED_TARGETS:
        log.warning('ws %s: target %r rejected (not in allow-list)', peer, target)
        await ws.close()
        return ws

    host, port_str = target.rsplit(':', 1)
    port = int(port_str)
    try:
        reader, writer = await asyncio.open_connection(host, port)
    except Exception as e:
        log.warning('ws %s: dial %s failed: %s', peer, target, e)
        await ws.close()
        return ws

    log.info('ws %s <-> %s opened', peer, target)

    async def pump_ws_to_tcp():
        try:
            async for m in ws:
                if m.type == WSMsgType.BINARY:
                    writer.write(m.data)
                    await writer.drain()
                elif m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
        except Exception as e:
            log.debug('ws %s: ws->tcp pump ended: %s', peer, e)
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def pump_tcp_to_ws():
        try:
            while not ws.closed:
                data = await reader.read(65536)
                if not data:
                    break
                await ws.send_bytes(data)
        except Exception as e:
            log.debug('ws %s: tcp->ws pump ended: %s', peer, e)
        finally:
            if not ws.closed:
                await ws.close()

    await asyncio.gather(pump_ws_to_tcp(), pump_tcp_to_ws(), return_exceptions=True)
    log.info('ws %s <-> %s closed', peer, target)
    return ws


async def healthz(_request: web.Request) -> web.Response:
    return web.Response(text='ok')


async def handle_nx(request: web.Request) -> web.StreamResponse:
    """Serve NX files from local disk with CORS headers.

    Live path: systemd deploys (buns-web.service) set NX_DIR=/opt/buns/nx.
    Group A removal reasoning missed these — restoring, no regression.
    """
    nx_path = request.match_info['path']
    filepath = os.path.join(NX_LOCAL_DIR, nx_path)
    if os.path.exists(filepath):
        return web.FileResponse(
            filepath,
            headers={'Access-Control-Allow-Origin': '*'},
        )
    log.warning("NX file not found: %s", filepath)
    return web.Response(status=404, text='Not found')


async def handle_client(request: web.Request) -> web.StreamResponse:
    """Serve self-hosted launcher assets (same box as /nx).

    Deploys set CLIENT_ASSETS_DIR=/opt/buns/client-assets. Nested keys
    allowed (e.g. assets/hair/00060000.img, server-wz.tar.gz); path
    containment enforced via realpath — no traversal, no symlink escape,
    never serves releases/* staging or dotfiles. aiohttp FileResponse
    handles Range/206, ETag, Content-Length natively.

    Cache semantics: immutable content-h addressed revision paths
    (/r/<sha256>/<key>) are immutable (long cache); mutable live keys are
    must-revalidate so a same-path new WZ can never stay stale.
    """
    raw = request.match_info['path']
    immutable = False
    if raw.startswith('r/'):
        parts = raw.split('/', 2)
        if len(parts) != 3 or not parts[1] or '/' in parts[1] or '\\' in parts[1] or '..' in parts[1]:
            return web.Response(status=400, text='Invalid revision path')
        immutable = True
        name = parts[2]
    else:
        name = raw
    if not name or '\\' in name or '..' in name:
        return web.Response(status=400, text='Invalid asset name')
    if any(p in ('', '.', 'releases') or p.startswith('.') for p in name.split('/')):
        return web.Response(status=404, text='Not found')
    base = os.path.realpath(CLIENT_ASSETS_DIR)
    filepath = os.path.realpath(os.path.join(base, *name.split('/')))
    if filepath != base and not filepath.startswith(base + os.sep):
        return web.Response(status=400, text='Invalid asset name')
    if immutable:
        # Revision path must match the addressed bytes; otherwise 404 so a
        # stale/wrong revision never serves live bytes under an immutable URL.
        digest = parts[1]
        h = hashlib.sha256()
        try:
            with open(filepath, 'rb') as f:
                for chunk in iter(lambda: f.read(1048576), b''):
                    h.update(chunk)
        except OSError:
            return web.Response(status=404, text='Not found')
        if h.hexdigest() != digest:
            return web.Response(status=404, text='Not found')
    if os.path.isfile(filepath):
        headers = {'Access-Control-Allow-Origin': '*'}
        if immutable:
            headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        else:
            headers['Cache-Control'] = 'public, max-age=60, must-revalidate'
        return web.FileResponse(filepath, headers=headers)
    log.warning("Client asset not found: %s", filepath)
    return web.Response(status=404, text='Not found')


@web.middleware
async def revalidate_client_files(request: web.Request, handler):
    """Revalidate routing config/page as well as the matched JS/WASM build pair."""
    response = await handler(request)
    if (request.path.startswith('/build/') or
            request.path in ('/', '/web/index.html', '/web/config.json', '/web/config.prod.json')):
        response.headers['Cache-Control'] = 'no-cache, must-revalidate'
    return response


def build_app() -> web.Application:
    app = web.Application(middlewares=[revalidate_client_files])
    app.router.add_get('/', handle_root)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/nx/{path:.*}', handle_nx)
    app.router.add_get('/client/{path:.*}', handle_client)
    # Static mounts. Route order matters — these only match if the path starts with /web or /build.
    app.router.add_static('/web/', path=os.path.join(STATIC_ROOT, 'web'), show_index=False)
    app.router.add_static('/build/', path=os.path.join(STATIC_ROOT, 'build'), show_index=False)
    return app


if __name__ == '__main__':
    log.info('starting on :%d, static_root=%s, allowed_targets=%s', PORT, STATIC_ROOT, sorted(ALLOWED_TARGETS))
    web.run_app(build_app(), host='0.0.0.0', port=PORT, print=None)
