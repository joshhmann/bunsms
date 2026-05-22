"""Combined static file server + NX proxy + WebSocket TCP proxy."""
import asyncio
import logging
import os
from aiohttp import web, WSMsgType, ClientSession

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
log = logging.getLogger('augur-ms-web')

STATIC_ROOT = os.environ.get('STATIC_ROOT', '/app')
PORT = int(os.environ.get('PORT', '8080'))
NX_LOCAL_DIR = os.environ.get('NX_DIR', '/opt/augurms/nx')

ALLOWED_TARGETS = {
    '192.168.0.157:9494',
    '192.168.0.157:7676',
    '192.168.0.157:7677',
    '192.168.0.157:7678',
}

async def handle_nx(request: web.Request) -> web.StreamResponse:
    """Serve NX files from local disk with CORS headers."""
    nx_path = request.match_info['path']
    filepath = os.path.join(NX_LOCAL_DIR, nx_path)
    if os.path.exists(filepath):
        return web.FileResponse(
            filepath,
            headers={'Access-Control-Allow-Origin': '*'}
        )
    log.warning(f"NX file not found: {filepath}")
    return web.Response(status=404, text='Not found')

async def handle_root(request: web.Request) -> web.StreamResponse:
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return await handle_ws_proxy(request)
    return web.FileResponse(os.path.join(STATIC_ROOT, 'web', 'index.html'))

async def handle_ws_proxy(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(max_msg_size=50 * 1024 * 1024)
    await ws.prepare(request)
    try:
        msg = await ws.receive(timeout=10)
    except asyncio.TimeoutError:
        await ws.close()
        return ws
    if msg.type == WSMsgType.TEXT:
        target = msg.data.strip()
    elif msg.type == WSMsgType.BINARY:
        target = msg.data.decode('utf-8').strip()
    else:
        await ws.close()
        return ws
    if target not in ALLOWED_TARGETS:
        log.warning(f"Rejected: {target}")
        await ws.close()
        return ws
    host, port = target.rsplit(':', 1)
    try:
        reader, writer = await asyncio.open_connection(host, int(port))
    except Exception as e:
        await ws.close()
        return ws
    async def pump_ws_to_tcp():
        try:
            async for m in ws:
                if m.type == WSMsgType.BINARY:
                    writer.write(m.data)
                    await writer.drain()
                elif m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
        finally:
            try: writer.close()
            except: pass
    async def pump_tcp_to_ws():
        try:
            while not ws.closed:
                data = await reader.read(65536)
                if not data: break
                await ws.send_bytes(data)
        finally:
            if not ws.closed:
                await ws.close()
    await asyncio.gather(pump_ws_to_tcp(), pump_tcp_to_ws(), return_exceptions=True)
    return ws

async def healthz(_request: web.Request) -> web.Response:
    return web.Response(text='ok')

def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get('/', handle_root)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/nx/{path:.*}', handle_nx)
    app.router.add_static('/web/', path=os.path.join(STATIC_ROOT, 'web'), show_index=False)
    app.router.add_static('/build/', path=os.path.join(STATIC_ROOT, 'build'), show_index=False)
    return app

if __name__ == '__main__':
    log.info(f"Starting on :{PORT}")
    web.run_app(build_app(), host='0.0.0.0', port=PORT, print=None)
